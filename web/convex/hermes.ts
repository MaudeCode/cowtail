import type {
  HermesCronIncident,
  HermesCronJob,
  HermesRecentAnswer,
  HermesSnapshot,
  HermesStatusLevel,
} from "@maudecode/cowtail-protocol";
import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { terminalItemStates } from "./itemModel";
import { appendItemEvent, createItem, openItemByDedupeKey, transitionItem } from "./items";

const HERMES = "hermes";
const COWTAIL = "cowtail";
const HEARTBEAT_LATE_AFTER_MS = 2 * 60_000;
const HEARTBEAT_MISSING_AFTER_MS = 5 * 60_000;
const HEARTBEAT_MISSING_KEY = "hermes:heartbeat-missing";

// --- Answers -------------------------------------------------------------------------

function responseRecord(response: Doc<"itemResponses">, item: Doc<"items"> | null) {
  return {
    id: String(response._id),
    itemId: String(response.itemId),
    replyTo: item?.replyTo ?? {},
    answer: response.answer,
    claimToken: response.claimToken!,
    leaseUntil: response.leaseUntil!,
    attempts: response.attempts,
    createdAt: response.createdAt,
  };
}

// Leases the oldest answer that is waiting, or whose last lease ran out without a result.
export const claimResponse = internalMutation({
  args: {
    workerId: v.string(),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, { workerId, claimToken, leaseSeconds, now }) => {
    const response = await ctx.db
      .query("itemResponses")
      .withIndex("by_status_availableAt", (q) => q.eq("status", "pending").lte("availableAt", now))
      .first();
    if (!response) return null;

    const leaseUntil = now + leaseSeconds * 1000;
    await ctx.db.patch(response._id, {
      claimToken,
      claimedBy: workerId,
      leaseUntil,
      availableAt: leaseUntil,
      attempts: response.attempts + 1,
      updatedAt: now,
    });
    return responseRecord((await ctx.db.get(response._id))!, await ctx.db.get(response.itemId));
  },
});

/**
 * Records what Hermes did with a claimed answer on the item's timeline and closes the item:
 * resolved once Hermes applied it, expired once Hermes no longer held the request.
 */
async function finishResponse(
  ctx: MutationCtx,
  { id, claimToken, now }: { id: string; claimToken: string; now: number },
  status: "done" | "failed",
  text: string,
) {
  const responseId = ctx.db.normalizeId("itemResponses", id);
  const response = responseId ? await ctx.db.get(responseId) : null;
  if (!response) throw new ConvexError({ code: "RESPONSE_NOT_FOUND" });
  // A lease that ran out and went to another claim no longer speaks for the answer.
  if (response.status !== "pending" || response.claimToken !== claimToken) {
    throw new ConvexError({ code: "RESPONSE_NOT_CLAIMED" });
  }

  await ctx.db.patch(response._id, { status, completedAt: now, updatedAt: now });
  const item = await ctx.db.get(response.itemId);
  if (!item) return;
  await appendItemEvent(ctx, item._id, "hermes_update", HERMES, now, { text });
  if (terminalItemStates.has(item.state)) {
    await ctx.db.patch(item._id, { updatedAt: now });
    return;
  }
  await transitionItem(ctx, item, status === "done" ? "resolved" : "expired", {
    actor: HERMES,
    at: now,
  });
}

const finishArgs = { id: v.string(), claimToken: v.string(), now: v.number() };

export const completeResponse = internalMutation({
  args: { ...finishArgs, text: v.optional(v.string()) },
  handler: async (ctx, { text, ...args }) => {
    await finishResponse(ctx, args, "done", text ?? "Hermes applied the answer.");
  },
});

export const failResponse = internalMutation({
  args: { ...finishArgs, reason: v.string() },
  handler: async (ctx, { reason, ...args }) => {
    await finishResponse(ctx, args, "failed", `Hermes could not apply the answer: ${reason}`);
  },
});

// --- Heartbeat -----------------------------------------------------------------------

export const recordHeartbeat = internalMutation({
  args: { snapshot: v.any(), now: v.number() },
  handler: async (ctx, { snapshot, now }) => {
    const current = await ctx.db.query("hermesStatus").first();
    if (current) {
      await ctx.db.patch(current._id, { snapshot, receivedAt: now });
    } else {
      await ctx.db.insert("hermesStatus", { snapshot, receivedAt: now });
    }

    const missing = await openItemByDedupeKey(ctx, COWTAIL, HEARTBEAT_MISSING_KEY);
    if (missing) {
      await transitionItem(ctx, missing, "resolved", {
        actor: COWTAIL,
        at: now,
        payload: { reason: "Hermes heartbeats resumed" },
      });
    }
  },
});

function statusLevel(age: number, missingItemOpen: boolean): HermesStatusLevel {
  if (missingItemOpen || age >= HEARTBEAT_MISSING_AFTER_MS) return "red";
  return age >= HEARTBEAT_LATE_AFTER_MS ? "amber" : "green";
}

// A cron status Hermes reports for a run that did not succeed.
const FAILED_CRON_STATUSES = new Set(["error", "failed", "failure", "timeout"]);

function cronJobs({ cronJobs, openIncidents }: HermesSnapshot) {
  const withIncident = new Set(openIncidents.map((incident) => incident.jobId));
  const jobs = cronJobs.map((job: HermesCronJob) => ({
    ...job,
    failing:
      withIncident.has(job.id) || FAILED_CRON_STATUSES.has(job.lastStatus?.toLowerCase() ?? ""),
  }));
  // Array sort is stable: each group keeps Hermes's order.
  return jobs.sort((a, b) => Number(b.failing) - Number(a.failing));
}

async function incidents(ctx: QueryCtx, { cronJobs, openIncidents }: HermesSnapshot) {
  const jobNames = new Map(cronJobs.map((job) => [job.id, job.name]));
  const linked = [];
  for (const incident of openIncidents as HermesCronIncident[]) {
    // The newest Hermes item for the incident, open or closed.
    const item = await ctx.db
      .query("items")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", `cron-incident:${incident.id}`))
      .order("desc")
      .filter((q) => q.eq(q.field("source"), HERMES))
      .first();
    linked.push({
      ...incident,
      jobName: jobNames.get(incident.jobId),
      itemId: item ? String(item._id) : undefined,
      itemTitle: item?.title,
    });
  }
  return linked;
}

const RECENT_ANSWERS_WINDOW_MS = 7 * 24 * 60 * 60_000;
const RECENT_ANSWERS_LIMIT = 20;
// Each state stops at this many recently updated items, so a flood of items cannot make the
// status fail.
const RECENT_ANSWERS_READ_LIMIT = 500;
const answerTypes = new Set(["approve", "deny", "choose", "reply"]);

// The answer the owner gave, from the newest answer on the item's timeline.
async function ownerAnswer(ctx: QueryCtx, itemId: Doc<"items">["_id"]) {
  const events = await ctx.db
    .query("itemEvents")
    .withIndex("by_item_at", (q) => q.eq("itemId", itemId))
    .order("desc")
    .collect();
  const event = events.find(
    (candidate) =>
      candidate.type === "action_taken" && answerTypes.has(String(candidate.payload.type)),
  );
  if (!event) return null;
  const { type, option, text } = event.payload;
  if (type === "choose") return { type, option: String(option) } as const;
  if (type === "reply") return { type, text: String(text) } as const;
  return { type } as HermesRecentAnswer["answer"];
}

async function recentAnswers(ctx: QueryCtx, now: number): Promise<HermesRecentAnswer[]> {
  const since = now - RECENT_ANSWERS_WINDOW_MS;
  const answered: Doc<"items">[] = [];
  for (const state of ["open", "acked", "snoozed", "resolved", "expired"] as const) {
    // Answering updates an item, so an item answered since `since` was updated since then.
    const items = await ctx.db
      .query("items")
      .withIndex("by_state_updatedAt", (q) => q.eq("state", state).gte("updatedAt", since))
      .order("desc")
      .take(RECENT_ANSWERS_READ_LIMIT);
    for (const item of items) {
      if (
        (item.kind === "approval" || item.kind === "question") &&
        item.answeredAt !== undefined &&
        item.answeredAt >= since
      ) {
        answered.push(item);
      }
    }
  }
  answered.sort((a, b) => b.answeredAt! - a.answeredAt!);

  const answers: HermesRecentAnswer[] = [];
  for (const item of answered.slice(0, RECENT_ANSWERS_LIMIT)) {
    const answer = await ownerAnswer(ctx, item._id);
    if (answer) {
      answers.push({
        itemId: String(item._id),
        title: item.title,
        answer,
        answeredAt: item.answeredAt!,
      });
    }
  }
  return answers;
}

export const getStatus = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const answers = await recentAnswers(ctx, now);
    const status = await ctx.db.query("hermesStatus").first();
    if (!status) return { status: null, recentAnswers: answers };

    const snapshot = status.snapshot as HermesSnapshot;
    const age = now - status.receivedAt;
    const missingItemOpen = Boolean(await openItemByDedupeKey(ctx, COWTAIL, HEARTBEAT_MISSING_KEY));
    const jobs = cronJobs(snapshot);
    return {
      status: {
        receivedAt: status.receivedAt,
        heartbeatMissing: age >= HEARTBEAT_MISSING_AFTER_MS,
        snapshot,
        statusLevel: statusLevel(age, missingItemOpen),
        cronJobs: jobs,
        failingCronCount: jobs.filter((job) => job.failing).length,
        incidents: await incidents(ctx, snapshot),
      },
      recentAnswers: answers,
    };
  },
});

// Runs every minute. Watching starts with the first heartbeat: a Cowtail whose Hermes has
// never reported has nothing to miss.
export const checkHeartbeat = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const status = await ctx.db.query("hermesStatus").first();
    if (!status || now - status.receivedAt < HEARTBEAT_MISSING_AFTER_MS) return;
    if (await openItemByDedupeKey(ctx, COWTAIL, HEARTBEAT_MISSING_KEY)) return;

    await createItem(
      ctx,
      {
        source: COWTAIL,
        kind: "failure",
        urgency: "now",
        title: "Hermes heartbeat missing",
        body: `Hermes has sent no heartbeat since ${new Date(status.receivedAt).toISOString()}.`,
        dedupeKey: HEARTBEAT_MISSING_KEY,
      },
      now,
    );
  },
});
