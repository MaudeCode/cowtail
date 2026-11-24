import type {
  ItemBatchPushData,
  ItemKind,
  ItemNotificationCategory,
  ItemPushData,
  ItemUrgency,
  QuietHours,
  SourceInfo,
} from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { ApsExtras } from "./apns";
import { appendItemEvent, ownerBadgeCount, type ItemDeliveryReason } from "./items";
import { effectivePreferences, preferencesRow } from "./notificationPreferences";
import { cowtailOwnerUserId } from "./owner";
import { sendPushToUser } from "./pushDelivery";
import { sourceInfo } from "./sources";

export const RESEND_INTERVAL_MS = 10 * 60_000;
export const MAX_RESENDS = 3;
export const TODAY_BATCH_WINDOW_MS = 5 * 60_000;

// --- Payloads -----------------------------------------------------------------------

const interruptionLevels = {
  now: "time-sensitive",
  today: "active",
  whenever: "passive",
} as const satisfies Record<ItemUrgency, ApsExtras["interruptionLevel"]>;

export function itemCategory(kind: ItemKind, approvalNeedsAuth = false): ItemNotificationCategory {
  if (kind === "approval") return approvalNeedsAuth ? "ITEM_APPROVAL_AUTH" : "ITEM_APPROVAL";
  if (kind === "question") return "ITEM_QUESTION";
  return "ITEM_ACK";
}

export type Push = {
  title: string;
  body: string;
  data: ItemPushData | ItemBatchPushData;
  aps: ApsExtras;
};

type PushItem = Pick<
  Doc<"items">,
  "_id" | "kind" | "urgency" | "title" | "body" | "dedupeKey" | "alertId"
> & { sourceInfo: SourceInfo; approvalNeedsAuth?: boolean };

// The owner's setting decides the approval category, so every device protects it alike.
async function pushItem(ctx: QueryCtx, item: Doc<"items">): Promise<PushItem> {
  const owner = cowtailOwnerUserId();
  const approvalNeedsAuth = owner
    ? effectivePreferences(await preferencesRow(ctx, owner)).requireAuthForApprovals
    : false;
  return { ...item, sourceInfo: await sourceInfo(ctx, item.source), approvalNeedsAuth };
}

// APNs refuses a payload over 4 KB. These budgets, in JSON-encoded UTF-8 bytes, keep the
// longest item a producer may send inside it with room for the rest of the payload.
const TITLE_BYTES = 400;
const BODY_BYTES = 2000;
const THREAD_BYTES = 400;

const encoder = new TextEncoder();
const jsonBytes = (text: string) => encoder.encode(JSON.stringify(text)).length - 2;

/** The text cut to fit `maxBytes` once JSON-encoded, ending in an ellipsis when cut. */
function fit(text: string, maxBytes: number) {
  if (jsonBytes(text) <= maxBytes) return text;
  let kept = "";
  let used = jsonBytes("…");
  for (const char of text) {
    used += jsonBytes(char);
    if (used > maxBytes) break;
    kept += char;
  }
  return `${kept}…`;
}

export function itemPush(item: PushItem, badge: number): Push {
  const data: ItemPushData = { itemId: String(item._id), source: item.sourceInfo };
  if (item.alertId) data.alertId = String(item.alertId);
  return {
    title: fit(item.title, TITLE_BYTES),
    body: fit(item.body, BODY_BYTES),
    data,
    aps: {
      mutableContent: 1,
      interruptionLevel: interruptionLevels[item.urgency],
      threadId: fit(item.dedupeKey ?? String(item._id), THREAD_BYTES),
      badge,
      category: itemCategory(item.kind, item.approvalNeedsAuth),
    },
  };
}

// One item keeps its own push; more become one summary from Cowtail.
export function batchPush(items: PushItem[], badge: number, cowtail: SourceInfo): Push {
  if (items.length === 1) return itemPush(items[0], badge);
  const shown = items.slice(0, 2).map((item) => item.title);
  const more = items.length - shown.length;
  const suffix = more > 0 ? `, ${more} more` : "";
  return {
    title: `${items.length} new items`,
    body: fit(shown.join(", "), BODY_BYTES - jsonBytes(suffix)) + suffix,
    data: { type: "item_batch", count: items.length, source: cowtail },
    aps: { mutableContent: 1, interruptionLevel: "active", badge },
  };
}

// --- Quiet hours --------------------------------------------------------------------

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** When `now` falls inside the quiet hours, the time they end; otherwise undefined. */
// ponytail: a DST change inside the window moves its end by the shift; fine for quiet hours.
export function quietHoursEndAt(now: number, quietHours: QuietHours): number | undefined {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: quietHours.timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = part("hour") * 60 + part("minute");
  const start = clockMinutes(quietHours.start);
  const end = clockMinutes(quietHours.end);
  const inside = start < end ? local >= start && local < end : local >= start || local < end;
  if (!inside) return undefined;
  const startOfMinute = now - part("second") * 1000 - (now % 1000);
  return startOfMinute + ((end - local + 1440) % 1440) * 60_000;
}

// --- Decisions ----------------------------------------------------------------------

const deliveryReasonValidator = v.union(
  v.literal("created"),
  v.literal("urgency_raised"),
  v.literal("reopened"),
  v.literal("resend"),
  v.literal("reminder"),
);

// A re-send carries when its chain's first push went out.
type DeliverItemArgs = {
  itemId: Id<"items">;
  reason: ItemDeliveryReason;
  attempt?: number;
  chainStartedAt?: number;
};
const deliverItemRef = makeFunctionReference<"action", DeliverItemArgs>("itemDelivery:deliverItem");
const flushBatchRef = makeFunctionReference<"action", { batchId: Id<"itemPushBatches"> }>(
  "itemDelivery:flushBatch",
);

type Planned = { userId: string; push: Push; itemIds: Id<"items">[] } | null;
const planDeliveryRef = makeFunctionReference<
  "mutation",
  {
    itemId: Id<"items">;
    reason: ItemDeliveryReason;
    attempt: number;
    chainStartedAt?: number;
    now: number;
  },
  Planned
>("itemDelivery:planDelivery");
const planBatchRef = makeFunctionReference<
  "mutation",
  { batchId: Id<"itemPushBatches">; now: number },
  Planned
>("itemDelivery:planBatch");
const recordPushRef = makeFunctionReference<
  "mutation",
  { itemIds: Id<"items">[]; payload: Record<string, unknown>; now: number }
>("itemDelivery:recordPush");

function recordDecision(
  ctx: MutationCtx,
  itemId: Id<"items">,
  now: number,
  payload: Record<string, unknown>,
) {
  return appendItemEvent(ctx, itemId, "notified", "cowtail", now, payload);
}

async function joinTodayBatch(ctx: MutationCtx, itemId: Id<"items">, now: number) {
  const pending = await ctx.db
    .query("itemPushBatches")
    .withIndex("by_sentAt", (q) => q.eq("sentAt", undefined))
    .collect();
  const open = pending.find((batch) => batch.windowEndsAt > now);
  if (open) {
    if (!open.itemIds.includes(itemId)) {
      await ctx.db.patch(open._id, { itemIds: [...open.itemIds, itemId] });
    }
    return open._id;
  }
  const windowEndsAt = now + TODAY_BATCH_WINDOW_MS;
  const batchId = await ctx.db.insert("itemPushBatches", { windowEndsAt, itemIds: [itemId] });
  await ctx.scheduler.runAt(windowEndsAt, flushBatchRef, { batchId });
  return batchId;
}

async function snoozedSince(ctx: QueryCtx, itemId: Id<"items">, since: number) {
  const events = await ctx.db
    .query("itemEvents")
    .withIndex("by_item_at", (q) => q.eq("itemId", itemId).gte("at", since))
    .collect();
  return events.some((event) => event.type === "state_changed" && event.payload.to === "snoozed");
}

/**
 * Decides what one delivery of an item does and records it as a `notified` event: skip it,
 * add it to the open `today` batch, or push it now and schedule the next re-send.
 */
export const planDelivery = internalMutation({
  args: {
    itemId: v.id("items"),
    reason: deliveryReasonValidator,
    attempt: v.number(),
    chainStartedAt: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, { itemId, reason, attempt, chainStartedAt, now }): Promise<Planned> => {
    const item = await ctx.db.get(itemId);
    if (!item) return null;
    const decided = { trigger: reason, attempt };
    const skip = async (why: string) => {
      await recordDecision(ctx, itemId, now, { ...decided, decision: "skipped", why });
      return null;
    };

    const userId = cowtailOwnerUserId();
    if (!userId) return await skip("no_owner");
    if (item.state !== "open") return await skip("not_open");
    // The owner asked to be reminded at this time: one push now, at least as loud as `today`.
    // The owner asked to be reminded at this time; the snooze took it out of its batch.
    if (reason === "reminder") {
      const urgency = item.urgency === "now" ? "now" : "today";
      return {
        userId,
        push: itemPush({ ...(await pushItem(ctx, item)), urgency }, await ownerBadgeCount(ctx)),
        itemIds: [itemId],
      };
    }
    if (item.urgency === "whenever") return await skip("whenever");
    if (reason === "resend" && item.urgency !== "now") return await skip("not_now");
    if (
      reason === "resend" &&
      chainStartedAt !== undefined &&
      (await snoozedSince(ctx, itemId, chainStartedAt))
    ) {
      return await skip("snoozed");
    }

    if (item.urgency === "today") {
      const batchId = await joinTodayBatch(ctx, itemId, now);
      await recordDecision(ctx, itemId, now, {
        ...decided,
        decision: "batched",
        batchId: String(batchId),
      });
      return null;
    }

    // ponytail: a now item reopened inside 10 minutes runs a second re-send chain beside the
    // first; key the chain to the push that started it if that double push matters.
    if (attempt < MAX_RESENDS) {
      await ctx.scheduler.runAt(now + RESEND_INTERVAL_MS, deliverItemRef, {
        itemId,
        reason: "resend",
        attempt: attempt + 1,
        chainStartedAt: chainStartedAt ?? now,
      });
    }
    return {
      userId,
      push: itemPush(await pushItem(ctx, item), await ownerBadgeCount(ctx)),
      itemIds: [itemId],
    };
  },
});

/**
 * Closes a `today` batch when its window ends. Inside quiet hours it waits for their end
 * instead; items that closed meanwhile drop out. The batch is sent once.
 */
export const planBatch = internalMutation({
  args: { batchId: v.id("itemPushBatches"), now: v.number() },
  handler: async (ctx, { batchId, now }): Promise<Planned> => {
    const batch = await ctx.db.get(batchId);
    const userId = cowtailOwnerUserId();
    if (!batch || batch.sentAt !== undefined || !userId) return null;

    const items = (await Promise.all(batch.itemIds.map((id) => ctx.db.get(id)))).filter(
      (item): item is Doc<"items"> => item !== null,
    );
    // An item raised to `now` was pushed on its own.
    const due = items.filter((item) => item.state === "open" && item.urgency === "today");
    const decided = { trigger: "batch", batchId: String(batchId) };

    const { quietHours } = effectivePreferences(await preferencesRow(ctx, userId));
    const quietEnd = quietHours ? quietHoursEndAt(now, quietHours) : undefined;
    if (quietEnd !== undefined && due.length > 0) {
      await ctx.db.patch(batchId, { windowEndsAt: quietEnd });
      await ctx.scheduler.runAt(quietEnd, flushBatchRef, { batchId });
      for (const item of due) {
        await recordDecision(ctx, item._id, now, {
          ...decided,
          decision: "held",
          why: "quiet_hours",
          until: quietEnd,
        });
      }
      return null;
    }

    await ctx.db.patch(batchId, { sentAt: now });
    for (const item of items) {
      if (due.includes(item)) continue;
      await recordDecision(ctx, item._id, now, {
        ...decided,
        decision: "skipped",
        why: item.state === "open" ? "not_today" : "not_open",
      });
    }
    if (due.length === 0) return null;
    return {
      userId,
      push: batchPush(
        await Promise.all(due.map((item) => pushItem(ctx, item))),
        await ownerBadgeCount(ctx),
        await sourceInfo(ctx, "cowtail"),
      ),
      itemIds: due.map((item) => item._id),
    };
  },
});

export const recordPush = internalMutation({
  args: {
    itemIds: v.array(v.id("items")),
    payload: v.record(v.string(), v.any()),
    now: v.number(),
  },
  handler: async (ctx, { itemIds, payload, now }) => {
    for (const itemId of itemIds) {
      await recordDecision(ctx, itemId, now, { ...payload, decision: "pushed" });
    }
  },
});

async function sendPlanned(
  ctx: Parameters<typeof sendPushToUser>[0],
  planned: NonNullable<Planned>,
  decided: Record<string, unknown>,
) {
  const result = await sendPushToUser(ctx, { userId: planned.userId, ...planned.push });
  await ctx.runMutation(recordPushRef, {
    itemIds: planned.itemIds,
    payload: {
      ...decided,
      title: planned.push.title,
      sent: result.sent,
      failed: result.failed,
    },
    now: Date.now(),
  });
}

/** The only path from an item to APNs. */
export const deliverItem = internalAction({
  args: {
    itemId: v.id("items"),
    reason: deliveryReasonValidator,
    attempt: v.optional(v.number()),
    chainStartedAt: v.optional(v.number()),
  },
  handler: async (ctx, { itemId, reason, attempt = 0, chainStartedAt }) => {
    const planned = await ctx.runMutation(planDeliveryRef, {
      itemId,
      reason,
      attempt,
      chainStartedAt,
      now: Date.now(),
    });
    if (planned) await sendPlanned(ctx, planned, { trigger: reason, attempt });
  },
});

export const flushBatch = internalAction({
  args: { batchId: v.id("itemPushBatches") },
  handler: async (ctx, { batchId }) => {
    const planned = await ctx.runMutation(planBatchRef, { batchId, now: Date.now() });
    if (planned) {
      await sendPlanned(ctx, planned, {
        trigger: "batch",
        batchId: String(batchId),
        size: planned.itemIds.length,
      });
    }
  },
});
