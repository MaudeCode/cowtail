import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const deliveryTargetValidator = v.literal("hermes:cowtail-alert-job");
const deliveryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
);

// Three fresh sessions at most. Transport retries keep their existing request ID.
const CLAIM_GRACE_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];
const claimGrace = (attempt: number) =>
  CLAIM_GRACE_MS[Math.min(attempt, CLAIM_GRACE_MS.length - 1)];

export const enqueue = internalMutation({
  args: {
    jobId: v.id("investigationJobs"),
    now: v.number(),
    freshAttempt: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jobDeliveries")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .first();
    const job = await ctx.db.get(args.jobId);
    // Coalesced notifications must not reset transport backoff, claim grace,
    // or the recovery budget. Only an explicit retry starts a new attempt.
    if (
      existing &&
      !args.freshAttempt &&
      (existing.status === "pending" || job?.attempts === (existing.jobAttempts ?? 0))
    ) {
      return existing._id;
    }

    return await ctx.db.insert("jobDeliveries", {
      jobId: args.jobId,
      target: "hermes:cowtail-alert-job",
      status: "pending",
      attempts: 0,
      jobAttempts: job?.attempts ?? 0,
      nextAttemptAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const recordAttempt = internalMutation({
  args: {
    id: v.id("jobDeliveries"),
    ok: v.boolean(),
    now: v.number(),
    statusCode: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.id);
    if (!delivery) {
      throw new Error("job delivery not found");
    }
    // Concurrent HTTP responses must not undo an acknowledgement or its recovery.
    if (delivery.status !== "pending") return { status: delivery.status };

    if (args.ok) {
      await ctx.db.patch(args.id, {
        status: "delivered",
        attempts: delivery.attempts + 1,
        lastAttemptAt: args.now,
        lastStatusCode: args.statusCode,
        lastError: undefined,
        claimCheckState:
          args.statusCode === 202 || args.statusCode === 200 ? "waiting" : "finished",
        nextAttemptAt: args.now + claimGrace(delivery.recoveryAttempt ?? 0),
        updatedAt: args.now,
      });
      return { status: "delivered" };
    }

    const retryScheduleMs = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
    const nextDelay = retryScheduleMs[Math.min(delivery.attempts, retryScheduleMs.length - 1)];
    await ctx.db.patch(args.id, {
      status: "pending",
      attempts: delivery.attempts + 1,
      lastAttemptAt: args.now,
      nextAttemptAt: args.now + nextDelay,
      lastStatusCode: args.statusCode,
      lastError: args.error,
      updatedAt: args.now,
    });
    return { status: "pending", nextAttemptAt: args.now + nextDelay };
  },
});

export const deferUntilJobDue = internalMutation({
  args: { id: v.id("jobDeliveries"), now: v.number() },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.id);
    if (!delivery || delivery.status !== "pending") return;
    const job = await ctx.db.get(delivery.jobId);
    if (!job || job.status !== "queued") return;
    await ctx.db.patch(delivery._id, {
      nextAttemptAt: Math.max(args.now, delivery.nextAttemptAt, job.nextAttemptAt),
      updatedAt: args.now,
    });
  },
});

export const getPending = query({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    return await ctx.db
      .query("jobDeliveries")
      .withIndex("by_status_nextAttemptAt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", args.now),
      )
      .take(limit);
  },
});

// Convex transaction conflicts serialize concurrent sweeps, claims and owner actions.
export const recoverUnclaimed = internalMutation({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 5, 20));
    let recovered = 0;
    let deadlettered = 0;
    // Undefined includes acknowledged rows created before this recovery existed.
    // Each row leaves this index partition, so history cannot starve new work.
    for (const state of [undefined, "waiting"] as const) {
      const candidates = await ctx.db
        .query("jobDeliveries")
        .withIndex("by_status_claimCheckState_nextAttemptAt", (q) =>
          q.eq("status", "delivered").eq("claimCheckState", state).lte("nextAttemptAt", args.now),
        )
        .take(limit);
      for (const delivery of candidates) {
        const job = await ctx.db.get(delivery.jobId);
        const latest = await ctx.db
          .query("jobDeliveries")
          .withIndex("by_jobId", (q) => q.eq("jobId", delivery.jobId))
          .order("desc")
          .first();
        await ctx.db.patch(delivery._id, { claimCheckState: "finished", updatedAt: args.now });
        if (
          !job ||
          job.status !== "queued" ||
          latest?._id !== delivery._id ||
          job.claimToken !== undefined ||
          job.claimedAt !== undefined ||
          job.attempts !== (delivery.jobAttempts ?? 0) ||
          (delivery.lastStatusCode !== 202 && delivery.lastStatusCode !== 200)
        )
          continue;

        const event = await ctx.db.get(job.sourceEventId);
        const members = await Promise.all(
          (event?.investigationAlertIds ?? [job.alertId]).map((id) => ctx.db.get(id)),
        );
        // Refusals are explicit domain state, never inferred from prompt text.
        if (
          members.some((alert) => !alert || alert.ownerDisposition) ||
          job.errorHistory.some((error) => !error.retryable)
        )
          continue;

        const attempt = delivery.recoveryAttempt ?? 0;
        const due = Math.max(
          job.nextAttemptAt,
          (delivery.lastAttemptAt ?? delivery.updatedAt) + claimGrace(attempt),
        );
        if (due > args.now) {
          await ctx.db.patch(delivery._id, { claimCheckState: "waiting", nextAttemptAt: due });
          continue;
        }

        const exhausted = attempt >= CLAIM_GRACE_MS.length;
        const error = exhausted
          ? "Hermes acknowledged delivery but no worker claimed the job; recovery limit reached"
          : "Hermes acknowledged delivery but no worker claimed the job; scheduling a fresh delivery";
        await ctx.db.patch(job._id, {
          ...(exhausted
            ? {
                status: "deadletter" as const,
                deadletteredAt: args.now,
                deadletterReason: error,
              }
            : {}),
          lastError: error,
          errorHistory: [
            ...job.errorHistory,
            {
              at: args.now,
              phase: "delivery-claim",
              error,
              retryable: !exhausted,
            },
          ],
          updatedAt: args.now,
        });
        if (exhausted) {
          deadlettered++;
          continue;
        }
        await ctx.db.insert("jobDeliveries", {
          jobId: job._id,
          target: delivery.target,
          status: "pending",
          attempts: 0,
          recoveryAttempt: attempt + 1,
          recoveredFrom: delivery._id,
          jobAttempts: job.attempts,
          nextAttemptAt: args.now,
          createdAt: args.now,
          updatedAt: args.now,
        });
        recovered++;
      }
    }
    return { recovered, deadlettered };
  },
});

export const getById = query({
  args: { id: v.id("jobDeliveries") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export { deliveryTargetValidator, deliveryStatusValidator };
