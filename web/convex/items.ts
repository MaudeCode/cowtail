import {
  itemInboxHandledWindowMs,
  type ItemEventType,
  type ItemKind,
  type ItemState,
  type ItemUrgency,
} from "@maudecode/cowtail-protocol";
import { ConvexError, type Infer, v } from "convex/values";
import { makeFunctionReference, type WithoutSystemFields } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { newestInvestigationJob } from "./alertLifecycle";
import {
  alertItemState,
  alertItemUrgency,
  alertOwnerActions,
  alertWorkflowState,
  itemAvailableActions,
  itemInvestigationStep,
  itemNeedsOwner,
  itemOutcome,
  itemSubtitle,
  terminalItemStates,
} from "./itemModel";
import {
  itemActionValidator,
  itemAnswerValidator,
  itemKindValidator,
  itemStateValidator,
  itemUrgencyValidator,
} from "./itemValidators";
import { effectivePreferences, preferencesRow } from "./notificationPreferences";
import { dateOnlyForInstant, resolveRoundupWindow } from "./roundup";
import { cowtailOwnerUserId } from "./owner";
import { sourceInfo } from "./sources";

type ItemFields = WithoutSystemFields<Doc<"items">>;
type NewItem = Omit<
  ItemFields,
  "state" | "createdAt" | "updatedAt" | "resolvedAt" | "snoozedUntil" | "occurrenceCount"
> & { occurrenceCount?: number };
// Every field but `state` and the fields that move with it; only transitionItem writes those.
type ItemContentPatch = Partial<
  Omit<ItemFields, "state" | "resolvedAt" | "snoozedUntil" | "createdAt">
>;

type Transition = {
  actor: string;
  at: number;
  snoozedUntil?: number;
  payload?: Record<string, unknown>;
  // False for writes that replay history, such as the alert backfill: they push nothing.
  notify?: boolean;
};

export function itemErrorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data?.code === "string"
    ? error.data.code
    : undefined;
}

export async function appendItemEvent(
  ctx: MutationCtx,
  itemId: Id<"items">,
  type: ItemEventType,
  actor: string,
  at: number,
  payload: Record<string, unknown> = {},
) {
  await ctx.db.insert("itemEvents", { itemId, at, type, actor, payload });
  if (type === "hermes_update" && typeof payload.text === "string") {
    await ctx.db.patch(itemId, { latestUpdate: { text: payload.text, at } });
  }
}

async function patchItemContent(ctx: MutationCtx, id: Id<"items">, patch: ItemContentPatch) {
  await ctx.db.patch(id, patch);
}

// --- Delivery -----------------------------------------------------------------------

export type ItemDeliveryReason = "created" | "urgency_raised" | "reopened" | "resend";

const deliverItemRef = makeFunctionReference<
  "action",
  { itemId: Id<"items">; reason: ItemDeliveryReason }
>("itemDelivery:deliverItem");

// Every push for an item runs through itemDelivery.deliverItem, which decides what it sends.
async function scheduleDelivery(ctx: MutationCtx, itemId: Id<"items">, reason: ItemDeliveryReason) {
  await ctx.scheduler.runAfter(0, deliverItemRef, { itemId, reason });
}

const urgencyRank: Record<ItemUrgency, number> = { whenever: 0, today: 1, now: 2 };

function raisesUrgency(from: ItemUrgency, to: ItemUrgency) {
  return urgencyRank[to] > urgencyRank[from];
}

// The owner's override for this source and kind, `source:kind` before `source`.
async function ownerUrgency(
  ctx: QueryCtx,
  item: { source: string; kind: ItemKind; urgency: ItemUrgency },
): Promise<ItemUrgency> {
  const owner = cowtailOwnerUserId();
  const overrides = owner ? (await preferencesRow(ctx, owner))?.urgencyOverrides : undefined;
  return overrides?.[`${item.source}:${item.kind}`] ?? overrides?.[item.source] ?? item.urgency;
}

/**
 * The only writer of `items.state`. Creating an item and every later state change append
 * the timeline event that records it; a transition to the current state writes nothing.
 */
export async function transitionItem(
  ctx: MutationCtx,
  target: Doc<"items"> | { create: NewItem },
  to: ItemState,
  { actor, at, snoozedUntil, payload = {}, notify = true }: Transition,
): Promise<Id<"items">> {
  const timing = {
    updatedAt: at,
    resolvedAt: to === "resolved" ? at : undefined,
    snoozedUntil: to === "snoozed" ? snoozedUntil : undefined,
  };

  if ("create" in target) {
    const id = await ctx.db.insert("items", {
      occurrenceCount: 1,
      ...target.create,
      urgency: await ownerUrgency(ctx, target.create),
      state: to,
      createdAt: at,
      ...timing,
    });
    await appendItemEvent(ctx, id, "created", actor, at, { ...payload, state: to });
    if (notify) await scheduleDelivery(ctx, id, "created");
    return id;
  }

  const item = target;
  if (item.state === to && item.snoozedUntil === timing.snoozedUntil) return item._id;
  await ctx.db.patch(item._id, { state: to, ...timing });
  if (notify && to === "open") await scheduleDelivery(ctx, item._id, "reopened");
  await appendItemEvent(
    ctx,
    item._id,
    to === "resolved" ? "resolved" : "state_changed",
    actor,
    at,
    {
      ...payload,
      from: item.state,
      to,
    },
  );
  return item._id;
}

async function requireItem(ctx: QueryCtx, rawId: string): Promise<Doc<"items">> {
  const id = ctx.db.normalizeId("items", rawId);
  const item = id ? await ctx.db.get(id) : null;
  if (!item) throw new ConvexError({ code: "ITEM_NOT_FOUND" });
  return item;
}

function requireOpenItem(item: Doc<"items">) {
  if (terminalItemStates.has(item.state)) {
    throw new ConvexError({ code: "ITEM_CLOSED", state: item.state });
  }
}

// One answer per item waits for its producer at a time; the producer closes the item after
// applying it, and a closed item takes no more answers.
async function queueItemResponse(
  ctx: MutationCtx,
  itemId: Id<"items">,
  answer: Doc<"itemResponses">["answer"],
  now: number,
) {
  const waiting = await ctx.db
    .query("itemResponses")
    .withIndex("by_itemId_status", (q) => q.eq("itemId", itemId).eq("status", "pending"))
    .first();
  if (waiting) throw new ConvexError({ code: "ANSWER_PENDING" });
  await ctx.db.insert("itemResponses", {
    itemId,
    answer,
    status: "pending",
    availableAt: now,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}

// --- Alert-linked items -------------------------------------------------------------

function webUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function alertItemContent(alert: Doc<"alerts">) {
  const sourceUrl = webUrl(alert.generatorURL);
  const context: Record<string, string> = {
    namespace: alert.namespace,
    severity: alert.severity,
    outcome: alert.outcome,
  };
  if (alert.node) context.node = alert.node;
  if (alertWorkflowState(alert) === "classifiedNoise") context.disposition = "noise";

  return {
    source: alert.source ?? "manual",
    kind: "alert" as const,
    urgency: alertItemUrgency(alert.severity),
    title: alert.alertname,
    body: alert.summary,
    links: sourceUrl ? [{ label: "Source", url: sourceUrl }] : [],
    context,
  };
}

async function itemForAlert(ctx: QueryCtx, alertId: Id<"alerts">) {
  return await ctx.db
    .query("items")
    .withIndex("by_alertId", (q) => q.eq("alertId", alertId))
    .first();
}

/**
 * Brings the alert's item in line with the alert: creates it on first sight, records
 * repeats, refreshes its content and moves its state. An owner's ack or snooze holds
 * while the alert stays open; a reopened alert reopens a closed item.
 */
export async function syncAlertItem(
  ctx: MutationCtx,
  alertId: Id<"alerts">,
  { actor, now, notify = true }: { actor: string; now: number; notify?: boolean },
) {
  const alert = await ctx.db.get(alertId);
  if (!alert) return;
  const raw = alertItemContent(alert);
  const content = { ...raw, urgency: await ownerUrgency(ctx, raw) };
  const occurrenceCount = alert.occurrenceCount ?? 1;
  const workflow = alertWorkflowState(alert);
  const wanted = alertItemState(workflow);
  // Timeline events stay in the order Cowtail records them, so a state change lands at
  // `now`, never at the alert's own (possibly earlier) end time.
  const closedAt = Math.max(now, alert.timestamp);

  let item = await itemForAlert(ctx, alertId);
  if (!item) {
    const id = await transitionItem(
      ctx,
      {
        create: {
          ...content,
          occurrenceCount,
          actions: [{ type: "ack" }, { type: "snooze" }],
          alertId,
        },
      },
      "open",
      { actor, at: alert.timestamp, notify },
    );
    if (wanted === "resolved") {
      await transitionItem(ctx, (await ctx.db.get(id))!, "resolved", {
        actor,
        at: closedAt,
        payload: { workflow },
        notify,
      });
    }
    return;
  }

  const changed = Object.entries(content).some(
    ([key, value]) => JSON.stringify(item![key as keyof typeof content]) !== JSON.stringify(value),
  );
  if (changed || occurrenceCount !== item.occurrenceCount) {
    await patchItemContent(ctx, item._id, { ...content, occurrenceCount, updatedAt: now });
  }
  if (occurrenceCount > item.occurrenceCount) {
    await appendItemEvent(ctx, item._id, "repeated", actor, now, { occurrenceCount });
  }
  // A closed item that reopens below is delivered as reopened.
  if (
    notify &&
    !terminalItemStates.has(item.state) &&
    raisesUrgency(item.urgency, content.urgency)
  ) {
    await scheduleDelivery(ctx, item._id, "urgency_raised");
  }

  item = (await ctx.db.get(item._id))!;
  if (wanted === "resolved") {
    await transitionItem(ctx, item, "resolved", {
      actor,
      at: closedAt,
      payload: { workflow },
      notify,
    });
  } else if (terminalItemStates.has(item.state)) {
    await transitionItem(ctx, item, "open", { actor, at: now, payload: { workflow }, notify });
  }
}

export async function recordAlertDispatch(
  ctx: MutationCtx,
  alertId: Id<"alerts">,
  jobId: Id<"investigationJobs">,
  now: number,
) {
  const item = await itemForAlert(ctx, alertId);
  if (!item) return;
  await patchItemContent(ctx, item._id, { investigationJobId: jobId, updatedAt: now });
  await appendItemEvent(ctx, item._id, "dispatched", "cowtail", now, {
    investigationJobId: String(jobId),
  });
}

export async function deleteItemsForAlert(ctx: MutationCtx, alertId: Id<"alerts">) {
  const items = await ctx.db
    .query("items")
    .withIndex("by_alertId", (q) => q.eq("alertId", alertId))
    .collect();
  for (const item of items) {
    const events = await ctx.db
      .query("itemEvents")
      .withIndex("by_item_at", (q) => q.eq("itemId", item._id))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    await ctx.db.delete(item._id);
  }
}

// --- Records ------------------------------------------------------------------------

async function alertContext(ctx: QueryCtx, item: Doc<"items">) {
  if (!item.alertId) return {};
  const alertId = item.alertId;
  const alert = await ctx.db.get(alertId);
  if (!alert) return {};
  const jobs = await ctx.db
    .query("investigationJobs")
    .withIndex("by_alertId", (q) => q.eq("alertId", alertId))
    .collect();
  return {
    alert,
    jobs,
    workflow: alertWorkflowState(alert, newestInvestigationJob(jobs)?.status),
  };
}

function investigationResult(alert: Doc<"alerts">) {
  const rootCause = alert.rootCause?.trim() || undefined;
  const action = alert.action.trim() || undefined;
  const ownerNote = alert.ownerNote?.trim() || undefined;
  return rootCause || action || ownerNote ? { rootCause, action, ownerNote } : undefined;
}

async function approvalsNeedAuth(ctx: QueryCtx) {
  const owner = cowtailOwnerUserId();
  return owner
    ? effectivePreferences(await preferencesRow(ctx, owner)).requireAuthForApprovals
    : false;
}

// The app badge: open items that need the owner.
// ponytail: reads every open item per push; add a counter when open items number thousands.
export async function ownerBadgeCount(ctx: QueryCtx) {
  const open = await ctx.db
    .query("items")
    .withIndex("by_state_updatedAt", (q) => q.eq("state", "open"))
    .collect();
  let count = 0;
  for (const item of open) {
    if (itemNeedsOwner(item, (await alertContext(ctx, item)).workflow)) count += 1;
  }
  return count;
}

async function itemRecord(ctx: QueryCtx, item: Doc<"items">) {
  const { _id, _creationTime, alertId, investigationJobId, ...fields } = item;
  const { alert, jobs, workflow } = await alertContext(ctx, item);
  const resolvedAt = item.state === "resolved" ? item.resolvedAt : undefined;
  return {
    ...fields,
    id: String(_id),
    sourceInfo: await sourceInfo(ctx, item.source),
    alertId: alertId ? String(alertId) : undefined,
    investigationJobId: investigationJobId ? String(investigationJobId) : undefined,
    needsOwner: itemNeedsOwner(item, workflow),
    availableActions: itemAvailableActions(item),
    contextOrder: Object.keys(item.context).sort(),
    alertActions: jobs ? alertOwnerActions(jobs) : undefined,
    investigationResult: alert ? investigationResult(alert) : undefined,
    approvalNeedsAuth: item.actions.some(
      (action) => action.type === "approve" || action.type === "deny",
    )
      ? await approvalsNeedAuth(ctx)
      : undefined,
    subtitle: itemSubtitle(item),
    investigationStep: terminalItemStates.has(item.state)
      ? undefined
      : itemInvestigationStep(workflow),
    outcome: resolvedAt === undefined ? undefined : itemOutcome(item, alert ?? null),
    resolvedAfterMs:
      resolvedAt === undefined ? undefined : Math.max(0, resolvedAt - item.createdAt),
  };
}

type ItemRecord = Awaited<ReturnType<typeof itemRecord>>;

function matchesSearch(record: ItemRecord, q: string) {
  const needle = q.toLowerCase();
  return [record.title, record.subtitle ?? "", record.body].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

// --- Functions ----------------------------------------------------------------------

// The fields a producer sends to create an item; `create` and the Hermes hook ingest take them.
export const createItemRequest = v.object({
  source: v.string(),
  kind: itemKindValidator,
  urgency: itemUrgencyValidator,
  title: v.string(),
  body: v.optional(v.string()),
  links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
  context: v.optional(v.record(v.string(), v.string())),
  dedupeKey: v.optional(v.string()),
  actions: v.optional(v.array(itemActionValidator)),
  replyTo: v.optional(v.record(v.string(), v.any())),
  expiresAt: v.optional(v.number()),
});

type CreateItemRequest = Infer<typeof createItemRequest>;

/**
 * The open item a source's `dedupeKey` names, if any. A dedupeKey belongs to its source:
 * another source's item never answers for it.
 */
export async function openItemByDedupeKey(ctx: QueryCtx, source: string, dedupeKey: string) {
  const matches = await ctx.db
    .query("items")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .collect();
  return matches.find((item) => item.source === source && !terminalItemStates.has(item.state));
}

/** Creates an item, or records a repeat on the open item that shares its `dedupeKey`. */
export async function createItem(ctx: MutationCtx, request: CreateItemRequest, now: number) {
  const actor = request.source;
  if (request.dedupeKey) {
    const open = await openItemByDedupeKey(ctx, request.source, request.dedupeKey);
    if (open) {
      const occurrenceCount = open.occurrenceCount + 1;
      const urgency = await ownerUrgency(ctx, request);
      const raised = raisesUrgency(open.urgency, urgency);
      await patchItemContent(ctx, open._id, {
        occurrenceCount,
        updatedAt: now,
        ...(raised ? { urgency } : {}),
      });
      await appendItemEvent(ctx, open._id, "repeated", actor, now, {
        occurrenceCount,
        title: request.title,
        ...(raised ? { urgency } : {}),
      });
      if (raised) await scheduleDelivery(ctx, open._id, "urgency_raised");
      return { id: String(open._id), created: false, occurrenceCount };
    }
  }

  const id = await transitionItem(
    ctx,
    {
      create: {
        ...request,
        body: request.body ?? "",
        links: request.links ?? [],
        context: request.context ?? {},
        actions: request.actions ?? [],
      },
    },
    "open",
    { actor, at: now },
  );
  return { id: String(id), created: true, occurrenceCount: 1 };
}

export const create = internalMutation({
  args: { ...createItemRequest.fields, now: v.number() },
  handler: async (ctx, { now, ...request }) => await createItem(ctx, request, now),
});

export const appendEvent = internalMutation({
  args: {
    id: v.string(),
    event: v.union(
      v.object({ type: v.literal("hermes_update"), text: v.string() }),
      v.object({
        type: v.literal("state_changed"),
        to: v.union(v.literal("resolved"), v.literal("expired")),
        reason: v.optional(v.string()),
      }),
    ),
    actor: v.string(),
    // Set for a source token, which may only touch its own source's items.
    source: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, { id, event, actor, source, now }) => {
    const item = await requireItem(ctx, id);
    if (source !== undefined && item.source !== source) {
      throw new ConvexError({ code: "ITEM_OTHER_SOURCE" });
    }
    if (event.type === "hermes_update") {
      await appendItemEvent(ctx, item._id, "hermes_update", actor, now, { text: event.text });
      await patchItemContent(ctx, item._id, { updatedAt: now });
      return;
    }
    if (item.state === event.to) return;
    requireOpenItem(item);
    await transitionItem(ctx, item, event.to, {
      actor,
      at: now,
      payload: event.reason ? { reason: event.reason } : {},
    });
  },
});

export const applyAction = internalMutation({
  args: {
    id: v.string(),
    action: v.union(
      itemAnswerValidator,
      v.object({ type: v.literal("snooze"), until: v.number() }),
    ),
    actor: v.string(),
    now: v.number(),
    authenticated: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, action, actor, now, authenticated }) => {
    const item = await requireItem(ctx, id);
    requireOpenItem(item);

    // An answer sent without Face ID is refused while the owner requires it.
    // An older app sends no flag at all; that counts as no Face ID too.
    if (authenticated !== true && (action.type === "approve" || action.type === "deny")) {
      if (await approvalsNeedAuth(ctx)) throw new ConvexError({ code: "APPROVAL_NEEDS_AUTH" });
    }

    if (action.type === "snooze" && action.until <= now) {
      throw new ConvexError({ code: "INVALID_SNOOZE" });
    }
    const offered = itemAvailableActions(item).find((candidate) => candidate.type === action.type);
    if (action.type !== "ack" && action.type !== "snooze") {
      const chosenOptionOffered =
        action.type !== "choose" ||
        (offered?.type === "choose" && offered.options.includes(action.option));
      if (!offered || !chosenOptionOffered) {
        throw new ConvexError({ code: "ACTION_NOT_OFFERED", action: action.type });
      }
    }

    // An answer to an action the producer offered goes back to it; a plain ack stays here.
    if (offered && item.replyTo && action.type !== "snooze") {
      await queueItemResponse(ctx, item._id, action, now);
    }
    await appendItemEvent(ctx, item._id, "action_taken", actor, now, { ...action });
    if (action.type === "ack") {
      await transitionItem(ctx, item, "acked", { actor, at: now });
    } else if (action.type === "snooze") {
      await transitionItem(ctx, item, "snoozed", { actor, at: now, snoozedUntil: action.until });
    } else {
      // The producer closes the item once it has applied the answer; until then the item
      // waits on the producer, not the owner.
      await patchItemContent(ctx, item._id, { updatedAt: now, answeredAt: now });
    }
  },
});

const EXPIRE_BATCH_SIZE = 100;

// Runs every minute: an item still waiting past its deadline expires. An item whose answer is
// on its way to the producer waits for the producer, who resolves or expires it.
export const expireDueItems = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const state of ["open", "acked", "snoozed"] as const) {
      const due = await ctx.db
        .query("items")
        .withIndex("by_state_expiresAt", (q) =>
          q.eq("state", state).gte("expiresAt", 0).lte("expiresAt", now),
        )
        .take(EXPIRE_BATCH_SIZE);
      for (const item of due) {
        const answering = await ctx.db
          .query("itemResponses")
          .withIndex("by_itemId_status", (q) => q.eq("itemId", item._id).eq("status", "pending"))
          .first();
        if (answering) continue;
        await transitionItem(ctx, item, "expired", {
          actor: "cowtail",
          at: now,
          payload: { reason: "The deadline passed without an answer" },
        });
      }
    }
  },
});

export const list = internalQuery({
  args: {
    state: v.optional(itemStateValidator),
    needsOwner: v.optional(v.boolean()),
    source: v.optional(v.string()),
    kind: v.optional(itemKindValidator),
    outcome: v.optional(v.string()),
    alertId: v.optional(v.string()),
    q: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.number(),
    cursor: v.optional(v.string()),
    timeZone: v.string(),
  },
  handler: async (ctx, args) => {
    const { source, kind, outcome, q, from, to, timeZone } = args;
    // Only an open item can need the owner, so that filter reads open items alone.
    const state = args.needsOwner ? (args.state ?? "open") : args.state;
    const matches = async (item: Doc<"items">) => {
      if (state !== undefined && item.state !== state) return null;
      if (source !== undefined && item.source !== source) return null;
      if (from !== undefined && item.createdAt < from) return null;
      if (to !== undefined && item.createdAt > to) return null;
      const record = await itemRecord(ctx, item);
      const kept =
        (args.needsOwner === undefined || record.needsOwner === args.needsOwner) &&
        (kind === undefined || record.kind === kind) &&
        (outcome === undefined || record.outcome === outcome) &&
        (q === undefined || matchesSearch(record, q));
      return kept
        ? { ...record, createdDate: dateOnlyForInstant(new Date(item.createdAt), timeZone) }
        : null;
    };
    // ponytail: counts every item created on each listed day; keep a per-day counter if a
    // day ever holds thousands of items.
    const dayCounts = async (records: { createdDate: string }[]) => {
      const days: { date: string; count: number }[] = [];
      for (const date of new Set(records.map((record) => record.createdDate))) {
        const window = resolveRoundupWindow(date, date, timeZone);
        const created = await ctx.db
          .query("items")
          .withIndex("by_createdAt", (q) =>
            q.gte("createdAt", window.fromTimestamp).lte("createdAt", window.toTimestamp),
          )
          .collect();
        let count = 0;
        for (const item of created) if (await matches(item)) count += 1;
        days.push({ date, count });
      }
      return days;
    };

    // An alert has one item, so this filter reads it alone.
    if (args.alertId !== undefined) {
      const alertId = ctx.db.normalizeId("alerts", args.alertId);
      const item = alertId
        ? await ctx.db
            .query("items")
            .withIndex("by_alertId", (q) => q.eq("alertId", alertId))
            .first()
        : null;
      const record = item ? await matches(item) : null;
      const items = record ? [record] : [];
      return { items, days: await dayCounts(items), nextCursor: undefined };
    }

    if (args.needsOwner && state !== "open") return { items: [], days: [], nextCursor: undefined };

    // ponytail: the range builder's types change after each bound; `any` keeps one helper.
    const createdAtRange = (q: any) => {
      let range = q;
      if (from !== undefined) range = range.gte("createdAt", from);
      if (to !== undefined) range = range.lte("createdAt", to);
      return range;
    };
    const items = ctx.db.query("items");
    const query = state
      ? items.withIndex("by_state_updatedAt", (q) => q.eq("state", state))
      : source
        ? items.withIndex("by_source_createdAt", (q) => createdAtRange(q.eq("source", source)))
        : items.withIndex("by_createdAt", (q) => createdAtRange(q));

    // One page reads at most `limit` items; filters checked after reading can leave it short.
    const page = await query
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });
    const records = [];
    for (const item of page.page) {
      const record = await matches(item);
      if (record) records.push(record);
    }
    return {
      items: records,
      days: await dayCounts(records),
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

// One indexed read per source: each read jumps past every item of the source before it.
export const sources = internalQuery({
  args: {},
  handler: async (ctx) => {
    const names: string[] = [];
    let next = await ctx.db.query("items").withIndex("by_source_createdAt").first();
    while (next) {
      const last = next.source;
      names.push(last);
      next = await ctx.db
        .query("items")
        .withIndex("by_source_createdAt", (q) => q.gt("source", last))
        .first();
    }
    return names;
  },
});

// Each state the inbox reads stops at this many items, so a producer that floods items
// cannot make the owner's inbox fail.
const INBOX_READ_LIMIT = 500;

export const inbox = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const byState = (state: ItemState) =>
      ctx.db
        .query("items")
        .withIndex("by_state_updatedAt", (q) => q.eq("state", state))
        .order("desc")
        .take(INBOX_READ_LIMIT);
    const active = [...(await byState("open")), ...(await byState("acked"))].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const needsYou: ItemRecord[] = [];
    const withHermes: ItemRecord[] = [];
    for (const item of active) {
      const record = await itemRecord(ctx, item);
      (record.needsOwner ? needsYou : withHermes).push(record);
    }

    // A resolved item was last updated no earlier than it resolved.
    const since = now - itemInboxHandledWindowMs;
    const recent = await ctx.db
      .query("items")
      .withIndex("by_state_updatedAt", (q) => q.eq("state", "resolved").gte("updatedAt", since))
      .order("desc")
      .take(INBOX_READ_LIMIT);
    const handled: ItemRecord[] = [];
    for (const item of recent) {
      if (item.resolvedAt !== undefined && item.resolvedAt >= since) {
        handled.push(await itemRecord(ctx, item));
      }
    }
    return { needsYou, withHermes, handled };
  },
});

export const get = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("items", args.id);
    const item = id ? await ctx.db.get(id) : null;
    if (!item) return null;
    const events = await ctx.db
      .query("itemEvents")
      .withIndex("by_item_at", (q) => q.eq("itemId", item._id))
      .collect();
    // ponytail: scans every fix, as fixes.getByAlertIds does; index fixes by alert if they
    // number thousands.
    const alertId = item.alertId;
    const fixes = alertId
      ? (await ctx.db.query("fixes").collect())
          .filter((fix) => fix.alertIds.includes(alertId))
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(({ _id, _creationTime, alertIds, ...fix }) => ({
            ...fix,
            id: String(_id),
            alertIds: alertIds.map(String),
          }))
      : [];
    return {
      item: await itemRecord(ctx, item),
      events: events.map(({ _id, _creationTime, itemId, ...event }) => ({
        ...event,
        id: String(_id),
        itemId: String(itemId),
      })),
      fixes,
    };
  },
});

const BACKFILL_PAGE_SIZE = 100;
// The committed generated api predates this module; Convex resolves it by name.
const backfillAlertItemsRef = makeFunctionReference<
  "mutation",
  { cursor?: string | null },
  { created: number; isDone: boolean }
>("items:backfillAlertItems");

// Creates the item for every alert that has none, one page per run. Safe to run again.
export const backfillAlertItems = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("alerts")
      .paginate({ cursor: args.cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    let created = 0;
    for (const alert of page.page) {
      if (await itemForAlert(ctx, alert._id)) continue;
      await syncAlertItem(ctx, alert._id, {
        actor: "backfill",
        notify: false,
        now: alert.resolvedAt ?? alert.lastReceivedAt ?? alert.timestamp,
      });
      created += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, backfillAlertItemsRef, {
        cursor: page.continueCursor,
      });
    }
    return { created, isDone: page.isDone };
  },
});
