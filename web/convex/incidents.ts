import {
  incidentChatPrefix,
  incidentGroupWindowMs,
  incidentPostmortemTimeoutMs,
  type IncidentActionType,
  type ItemUrgency,
} from "@maudecode/cowtail-protocol";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { terminalItemStates } from "./itemModel";
import { appendItemEvent, eventRecord, itemRecord } from "./items";

const COWTAIL = "cowtail";
const HERMES = "hermes";
const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_WINDOW_MS = 7 * DAY_MS;
const CANDIDATE_LIMIT = 50;
const CANDIDATE_READ_LIMIT = 500;
const PROMPT_BODY_CHARS = 1_000;
const PROMPT_EVENT_CHARS = 300;
const PROMPT_EVENT_LIMIT = 200;

const urgencyRank: Record<ItemUrgency, number> = { whenever: 0, today: 1, now: 2 };

function codedError(code: string): never {
  throw new ConvexError({ code });
}

export async function incidentMembers(ctx: QueryCtx, incidentId: Id<"incidents">) {
  return await ctx.db
    .query("items")
    .withIndex("by_incidentId", (q) => q.eq("incidentId", incidentId))
    .collect();
}

async function requireIncident(ctx: QueryCtx, rawId: string): Promise<Doc<"incidents">> {
  const id = ctx.db.normalizeId("incidents", rawId);
  const incident = id ? await ctx.db.get(id) : null;
  if (!incident) codedError("INCIDENT_NOT_FOUND");
  return incident;
}

async function requireItem(ctx: QueryCtx, rawId: string): Promise<Doc<"items">> {
  const id = ctx.db.normalizeId("items", rawId);
  const item = id ? await ctx.db.get(id) : null;
  if (!item) codedError("ITEM_NOT_FOUND");
  return item;
}

// --- Summary --------------------------------------------------------------------------------

function summarize(incident: Doc<"incidents">, members: Doc<"items">[], now: number) {
  const first = members.reduce<Doc<"items"> | undefined>(
    (oldest, member) => (!oldest || member.createdAt < oldest.createdAt ? member : oldest),
    undefined,
  );
  const worstUrgency = members.reduce<ItemUrgency | undefined>(
    (worst, member) =>
      worst === undefined || urgencyRank[member.urgency] > urgencyRank[worst]
        ? member.urgency
        : worst,
    undefined,
  );
  const startedAt = first?.createdAt ?? incident.createdAt;
  const end = incident.state === "resolved" ? (incident.resolvedAt ?? now) : now;
  return {
    id: String(incident._id),
    title: incident.title,
    state: incident.state,
    memberCount: members.length,
    worstUrgency,
    startedAt,
    resolvedAt: incident.state === "resolved" ? incident.resolvedAt : undefined,
    durationMs: Math.max(0, end - startedAt),
  };
}

export type IncidentSummary = ReturnType<typeof summarize>;

// A list of items reads each incident's members once per query, however many members it lists.
const summaryCache = new WeakMap<object, Map<string, Promise<IncidentSummary | undefined>>>();

export function incidentSummary(ctx: QueryCtx, incidentId: Id<"incidents">) {
  let cache = summaryCache.get(ctx);
  if (!cache) summaryCache.set(ctx, (cache = new Map()));
  let summary = cache.get(incidentId);
  if (!summary) {
    summary = (async () => {
      const incident = await ctx.db.get(incidentId);
      return incident
        ? summarize(incident, await incidentMembers(ctx, incidentId), Date.now())
        : undefined;
    })();
    cache.set(incidentId, summary);
  }
  return summary;
}

// --- Membership and state -------------------------------------------------------------------

type Writer = { actor: string; now: number };

async function insertIncident(
  ctx: MutationCtx,
  title: string,
  groupKey: string | undefined,
  { actor, now }: Writer,
) {
  const id = await ctx.db.insert("incidents", {
    title,
    state: "open",
    groupKey,
    createdAt: now,
    updatedAt: now,
    postmortemState: "none",
  });
  await ctx.db.insert("itemEvents", {
    incidentId: id,
    at: now,
    type: "created",
    actor,
    payload: { title },
  });
  return id;
}

async function addMember(
  ctx: MutationCtx,
  incidentId: Id<"incidents">,
  item: Doc<"items">,
  reason: string,
  { actor, now }: Writer,
) {
  await ctx.db.patch(item._id, { incidentId });
  await appendItemEvent(
    ctx,
    item._id,
    "item_added",
    actor,
    now,
    { itemTitle: item.title, reason },
    {
      incidentId,
    },
  );
  await ctx.db.patch(incidentId, { updatedAt: now });
}

// The generated api predates this module; Convex resolves it by name.
const failPostmortemRequestRef = makeFunctionReference<
  "mutation",
  { id: Id<"postmortemRequests"> }
>("incidents:failPostmortemRequest");

async function queuePostmortem(ctx: MutationCtx, incidentId: Id<"incidents">, now: number) {
  const id = await ctx.db.insert("postmortemRequests", {
    incidentId,
    status: "pending",
    availableAt: now,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(incidentPostmortemTimeoutMs, failPostmortemRequestRef, { id });
  await ctx.db.patch(incidentId, { postmortemState: "requested", updatedAt: now });
}

async function resolveIncident(
  ctx: MutationCtx,
  incident: Doc<"incidents">,
  reason: string,
  { actor, now }: Writer,
) {
  await ctx.db.patch(incident._id, { state: "resolved", resolvedAt: now, updatedAt: now });
  await ctx.db.insert("itemEvents", {
    incidentId: incident._id,
    at: now,
    type: "resolved",
    actor,
    payload: { from: "open", to: "resolved", reason },
  });
  await queuePostmortem(ctx, incident._id, now);
}

/**
 * Brings the incident's state in line with its members: it resolves once every member is
 * resolved or expired, and opens again when a member comes back (`reopened`). An owner's own
 * resolution holds while its open members stay open.
 */
export async function settleIncident(
  ctx: MutationCtx,
  incidentId: Id<"incidents">,
  { now, reopened }: { now: number; reopened: boolean },
) {
  const incident = await ctx.db.get(incidentId);
  if (!incident) return;
  const members = await incidentMembers(ctx, incidentId);
  const live = members.some((member) => !terminalItemStates.has(member.state));
  if (incident.state === "open" && members.length > 0 && !live) {
    await resolveIncident(ctx, incident, "Every item resolved or expired", { actor: COWTAIL, now });
  } else if (incident.state === "resolved" && reopened && live) {
    await ctx.db.patch(incidentId, { state: "open", resolvedAt: undefined, updatedAt: now });
  }
}

// The new incident's name: its Alertmanager group's labels, or the first item's title.
async function groupTitle(ctx: QueryCtx, item: Doc<"items">) {
  const alert = item.alertId ? await ctx.db.get(item.alertId) : null;
  const event = alert?.sourceEventId ? await ctx.db.get(alert.sourceEventId) : null;
  const labels = Object.values(event?.groupLabels ?? {}).filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  return labels.length > 0 ? labels.join(" · ") : item.title;
}

/**
 * A new alert item joins the open incident of its Alertmanager group that has a member
 * created within the group window of it. With none, a second item of the group within the
 * window forms an incident with the group's loose items; one alert alone does not.
 */
export async function groupAlertItem(
  ctx: MutationCtx,
  itemId: Id<"items">,
  groupKey: string,
  now: number,
) {
  await ctx.db.patch(itemId, { groupKey });
  const item = (await ctx.db.get(itemId))!;
  const near = (member: Doc<"items">) =>
    Math.abs(member.createdAt - item.createdAt) <= incidentGroupWindowMs;
  const writer = { actor: COWTAIL, now };

  const open = await ctx.db
    .query("incidents")
    .withIndex("by_groupKey_state", (q) => q.eq("groupKey", groupKey).eq("state", "open"))
    .collect();
  for (const incident of open) {
    if ((await incidentMembers(ctx, incident._id)).some(near)) {
      await addMember(ctx, incident._id, item, "Same Alertmanager group", writer);
      await settleIncident(ctx, incident._id, { now, reopened: false });
      return;
    }
  }

  const loose = (
    await ctx.db
      .query("items")
      .withIndex("by_groupKey_createdAt", (q) =>
        q
          .eq("groupKey", groupKey)
          .gte("createdAt", item.createdAt - incidentGroupWindowMs)
          .lte("createdAt", item.createdAt + incidentGroupWindowMs),
      )
      .collect()
  ).filter((member) => member._id !== item._id && member.incidentId === undefined);
  if (loose.length === 0) return;

  const incidentId = await insertIncident(ctx, await groupTitle(ctx, item), groupKey, writer);
  for (const member of [...loose, item]) {
    await addMember(ctx, incidentId, member, "Same Alertmanager group", writer);
  }
  await settleIncident(ctx, incidentId, { now, reopened: false });
}

// The owner makes an incident from chosen items, none of which belongs to one yet.
export const create = internalMutation({
  args: {
    title: v.optional(v.string()),
    itemIds: v.array(v.string()),
    actor: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { title, itemIds, actor, now }) => {
    const items: Doc<"items">[] = [];
    for (const rawId of new Set(itemIds)) {
      const item = await requireItem(ctx, rawId);
      if (item.incidentId) codedError("ITEM_IN_INCIDENT");
      items.push(item);
    }
    const writer = { actor, now };
    const incidentId = await insertIncident(ctx, title ?? items[0].title, undefined, writer);
    for (const item of items) await addMember(ctx, incidentId, item, "Added by hand", writer);
    await settleIncident(ctx, incidentId, { now, reopened: false });
    return String(incidentId);
  },
});

export const addItem = internalMutation({
  args: { id: v.string(), itemId: v.string(), actor: v.string(), now: v.number() },
  handler: async (ctx, { id, itemId, actor, now }) => {
    const incident = await requireIncident(ctx, id);
    const item = await requireItem(ctx, itemId);
    if (item.incidentId === incident._id) return;
    if (item.incidentId) codedError("ITEM_IN_INCIDENT");
    await addMember(ctx, incident._id, item, "Added by hand", { actor, now });
    await settleIncident(ctx, incident._id, {
      now,
      reopened: !terminalItemStates.has(item.state),
    });
  },
});

export const removeItem = internalMutation({
  args: { id: v.string(), itemId: v.string(), actor: v.string(), now: v.number() },
  handler: async (ctx, { id, itemId, actor, now }) => {
    const incident = await requireIncident(ctx, id);
    const item = await requireItem(ctx, itemId);
    if (item.incidentId !== incident._id) codedError("ITEM_NOT_IN_INCIDENT");
    await ctx.db.patch(item._id, { incidentId: undefined });
    await appendItemEvent(
      ctx,
      item._id,
      "item_removed",
      actor,
      now,
      { itemTitle: item.title, reason: "Removed by hand" },
      { incidentId: incident._id },
    );
    await ctx.db.patch(incident._id, { updatedAt: now });
    await settleIncident(ctx, incident._id, { now, reopened: false });
  },
});

// The owner closes the incident now, whatever its members; resolving it again does nothing.
export const resolve = internalMutation({
  args: { id: v.string(), actor: v.string(), now: v.number() },
  handler: async (ctx, { id, actor, now }) => {
    const incident = await requireIncident(ctx, id);
    if (incident.state === "resolved") return;
    await resolveIncident(ctx, incident, "Resolved by hand", { actor, now });
  },
});

// The owner asks Hermes for the postmortem again, once the last request is over.
export const requestPostmortem = internalMutation({
  args: { id: v.string(), now: v.number() },
  handler: async (ctx, { id, now }) => {
    const incident = await requireIncident(ctx, id);
    if (incident.state !== "resolved") codedError("INCIDENT_OPEN");
    if (incident.postmortemState === "requested") codedError("POSTMORTEM_PENDING");
    await queuePostmortem(ctx, incident._id, now);
  },
});

// --- Hermes ---------------------------------------------------------------------------------

function iso(at: number) {
  return new Date(at).toISOString();
}

function clip(text: string, chars: number) {
  return text.length > chars ? `${text.slice(0, chars)}…` : text;
}

// One timeline line: what happened, to which member, and the event's own words.
function promptEventLine(event: Doc<"itemEvents">, titles: Map<string, string>) {
  const { payload } = event;
  const member = event.itemId ? titles.get(event.itemId) : undefined;
  const words = [
    payload.text,
    payload.reason,
    payload.from && payload.to ? `${payload.from} → ${payload.to}` : undefined,
    payload.scriptName,
    payload.exitCode === undefined ? undefined : `exit ${payload.exitCode}`,
    payload.type,
    payload.option,
  ].filter((word) => typeof word === "string" || typeof word === "number");
  const what = [event.type, member ?? payload.itemTitle].filter(Boolean).join(" · ");
  return `- ${iso(event.at)} ${what}${words.length ? `: ${clip(words.join(", "), PROMPT_EVENT_CHARS)}` : ""}`;
}

async function mergedEvents(ctx: QueryCtx, incidentId: Id<"incidents">, members: Doc<"items">[]) {
  const byId = new Map<string, Doc<"itemEvents">>();
  for (const member of members) {
    const events = await ctx.db
      .query("itemEvents")
      .withIndex("by_item_at", (q) => q.eq("itemId", member._id))
      .collect();
    for (const event of events) byId.set(event._id, event);
  }
  const own = await ctx.db
    .query("itemEvents")
    .withIndex("by_incident_at", (q) => q.eq("incidentId", incidentId))
    .collect();
  for (const event of own) byId.set(event._id, event);
  // Events written in one moment keep the order they were written in.
  return [...byId.values()].sort(
    (a, b) => a.at - b.at || a._creationTime - b._creationTime || a._id.localeCompare(b._id),
  );
}

// What Hermes needs to write the postmortem: the incident, each member with its investigation,
// the merged timeline and the runbook runs, then what to write.
async function postmortemPrompt(ctx: QueryCtx, incident: Doc<"incidents">) {
  const members = await incidentMembers(ctx, incident._id);
  const summary = summarize(incident, members, Date.now());
  const titles = new Map(members.map((member) => [String(member._id), member.title]));
  const lines = [
    `Write the postmortem for the Cowtail incident "${incident.title}".`,
    `Started ${iso(summary.startedAt)}; resolved ${
      incident.resolvedAt ? iso(incident.resolvedAt) : "not yet"
    }; ${Math.round(summary.durationMs / 60_000)} minutes; ${members.length} items.`,
    "",
    "## Items",
  ];
  for (const member of members) {
    lines.push(`- ${member.title} (${member.kind}, ${member.urgency}, ${member.state})`);
    if (member.body)
      lines.push(`  ${clip(member.body, PROMPT_BODY_CHARS).replaceAll("\n", "\n  ")}`);
    const alert = member.alertId ? await ctx.db.get(member.alertId) : null;
    if (alert?.rootCause) lines.push(`  Investigation root cause: ${alert.rootCause}`);
    if (alert?.action.trim()) lines.push(`  Investigation action: ${alert.action}`);
  }

  const events = await mergedEvents(ctx, incident._id, members);
  const runs = events.filter((event) => event.type === "run_finished");
  lines.push("", "## Timeline");
  for (const event of events.slice(-PROMPT_EVENT_LIMIT)) lines.push(promptEventLine(event, titles));
  lines.push("", "## Runbook runs");
  if (runs.length === 0) lines.push("- None");
  for (const run of runs) {
    const { scriptName, status, exitCode, excerpt } = run.payload;
    lines.push(`- ${scriptName} ${status}${exitCode === undefined ? "" : ` (exit ${exitCode})`}`);
    if (typeof excerpt === "string" && excerpt) {
      lines.push(`  ${clip(excerpt, PROMPT_BODY_CHARS).replaceAll("\n", "\n  ")}`);
    }
  }
  lines.push(
    "",
    "Reply with only the postmortem, in Markdown, with these sections: Summary, Impact window, " +
      "Root cause, What fixed it, Follow-ups. Keep it short. Your reply in this chat is stored " +
      "on the incident as its postmortem.",
  );
  return lines.join("\n");
}

// Leases the oldest postmortem request still waiting for Hermes, with the prompt to deliver.
export const claimRequest = internalMutation({
  args: {
    workerId: v.string(),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, { workerId, claimToken, leaseSeconds, now }) => {
    const request = await ctx.db
      .query("postmortemRequests")
      .withIndex("by_status_availableAt", (q) => q.eq("status", "pending").lte("availableAt", now))
      .first();
    if (!request) return null;
    const incident = (await ctx.db.get(request.incidentId))!;
    const leaseUntil = now + leaseSeconds * 1000;
    await ctx.db.patch(request._id, {
      claimToken,
      claimedBy: workerId,
      availableAt: leaseUntil,
      attempts: request.attempts + 1,
      updatedAt: now,
    });
    return {
      id: String(request._id),
      incidentId: String(incident._id),
      chatId: `${incidentChatPrefix}${incident._id}`,
      prompt: await postmortemPrompt(ctx, incident),
      claimToken,
      leaseUntil,
      attempts: request.attempts + 1,
      createdAt: request.createdAt,
    };
  },
});

// Hermes has the prompt: the request is never leased again and waits for the postmortem.
export const markDelivered = internalMutation({
  args: { id: v.string(), claimToken: v.string(), now: v.number() },
  handler: async (ctx, { id, claimToken, now }) => {
    const requestId = ctx.db.normalizeId("postmortemRequests", id);
    const request = requestId ? await ctx.db.get(requestId) : null;
    if (!request) codedError("POSTMORTEM_REQUEST_NOT_FOUND");
    if (request.status === "delivered" && request.claimToken === claimToken) return;
    // A lease that ran out and went to another claim no longer speaks for the request.
    if (request.status !== "pending" || request.claimToken !== claimToken) {
      codedError("POSTMORTEM_REQUEST_NOT_CLAIMED");
    }
    await ctx.db.patch(request._id, { status: "delivered", updatedAt: now });
  },
});

async function requestsInFlight(ctx: QueryCtx, incidentId: Id<"incidents">) {
  const requests = await ctx.db
    .query("postmortemRequests")
    .withIndex("by_incidentId", (q) => q.eq("incidentId", incidentId))
    .collect();
  return requests.filter(
    (request) => request.status === "pending" || request.status === "delivered",
  );
}

// Hermes's reply in the incident's chat, for the request it answers; without one, for the
// newest request. A reply to an older request completes only that request: it never replaces
// the result of a newer one. The first reply to a request, or a late one after it failed,
// records the postmortem on the timeline; a later message in the chat replaces the text.
export const recordPostmortem = internalMutation({
  args: { id: v.string(), text: v.string(), requestId: v.optional(v.string()), now: v.number() },
  handler: async (ctx, { id, text, requestId, now }) => {
    const incident = await requireIncident(ctx, id);
    const requests = (
      await ctx.db
        .query("postmortemRequests")
        .withIndex("by_incidentId", (q) => q.eq("incidentId", incident._id))
        .collect()
    ).sort((a, b) => a._creationTime - b._creationTime);
    const newest = requests.at(-1);
    const answered = requestId ? requests.find((request) => request._id === requestId) : newest;
    if (requestId && !answered) codedError("POSTMORTEM_REQUEST_NOT_FOUND");
    const inFlight = answered?.status === "pending" || answered?.status === "delivered";
    if (answered && inFlight) {
      await ctx.db.patch(answered._id, { status: "written", updatedAt: now });
    }
    if (answered !== newest) return;

    await ctx.db.patch(incident._id, {
      postmortem: text,
      postmortemAt: now,
      postmortemState: "written",
      updatedAt: now,
    });
    if (inFlight || incident.postmortemState !== "written") {
      await ctx.db.insert("itemEvents", {
        incidentId: incident._id,
        at: now,
        type: "postmortem_written",
        actor: HERMES,
        payload: {},
      });
    }
  },
});

// A request still waiting for its postmortem when its time is up fails, and the owner can ask
// again. A newer request for the incident still in flight keeps the incident requested.
export const failPostmortemRequest = internalMutation({
  args: { id: v.id("postmortemRequests") },
  handler: async (ctx, { id }) => {
    const request = await ctx.db.get(id);
    if (request?.status !== "pending" && request?.status !== "delivered") return;
    const now = Date.now();
    await ctx.db.patch(id, { status: "failed", updatedAt: now });
    const incident = await ctx.db.get(request.incidentId);
    const newer = await requestsInFlight(ctx, request.incidentId);
    if (incident?.postmortemState === "requested" && newer.length === 0) {
      await ctx.db.patch(incident._id, { postmortemState: "failed", updatedAt: now });
    }
  },
});

// --- Reads ----------------------------------------------------------------------------------

function availableActions(incident: Doc<"incidents">): IncidentActionType[] {
  if (incident.state === "open") return ["resolve"];
  return incident.postmortemState === "requested" ? [] : ["request_postmortem"];
}

export const get = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("incidents", args.id);
    const incident = id ? await ctx.db.get(id) : null;
    if (!incident) return null;
    const members = await incidentMembers(ctx, incident._id);
    const summary = summarize(incident, members, Date.now());
    const titles = new Map(members.map((member) => [String(member._id), member.title]));
    const events = await mergedEvents(ctx, incident._id, members);
    const records = [];
    for (const member of members.sort((a, b) => b.createdAt - a.createdAt)) {
      records.push(await itemRecord(ctx, member));
    }
    return {
      incident: {
        ...summary,
        createdAt: incident.createdAt,
        postmortemState: incident.postmortemState,
        postmortem: incident.postmortem,
        postmortemAt: incident.postmortemAt,
        availableActions: availableActions(incident),
      },
      members: records,
      events: events.map((event) => {
        const itemTitle = event.itemId ? titles.get(event.itemId) : undefined;
        return {
          ...eventRecord(event),
          itemTitle:
            itemTitle ??
            (typeof event.payload.itemTitle === "string" ? event.payload.itemTitle : undefined),
        };
      }),
    };
  },
});

// The items the owner can add: the newest created in the last week in no incident.
export const candidates = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireIncident(ctx, id);
    const recent = await ctx.db
      .query("items")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", Date.now() - CANDIDATE_WINDOW_MS))
      .order("desc")
      .take(CANDIDATE_READ_LIMIT);
    const records = [];
    for (const item of recent) {
      if (item.incidentId) continue;
      records.push(await itemRecord(ctx, item));
      if (records.length === CANDIDATE_LIMIT) break;
    }
    return records;
  },
});
