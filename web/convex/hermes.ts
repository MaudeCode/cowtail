import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { terminalItemStates } from "./itemModel";
import { appendItemEvent, createItem, openItemByDedupeKey, transitionItem } from "./items";

const HERMES = "hermes";
const COWTAIL = "cowtail";
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

export const getStatus = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const status = await ctx.db.query("hermesStatus").first();
    if (!status) return null;
    return {
      receivedAt: status.receivedAt,
      heartbeatMissing: now - status.receivedAt >= HEARTBEAT_MISSING_AFTER_MS,
      snapshot: status.snapshot,
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
