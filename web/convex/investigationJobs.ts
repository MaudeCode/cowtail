import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("deadletter"),
);

const priorityValidator = v.union(v.literal("low"), v.literal("normal"), v.literal("high"));

const errorEntryValidator = v.object({
  at: v.number(),
  phase: v.string(),
  error: v.string(),
  retryable: v.boolean(),
});

export const createOrCoalesceForAlert = internalMutation({
  args: {
    alertId: v.id("alerts"),
    sourceEventId: v.id("alertmanagerEvents"),
    fingerprint: v.string(),
    dedupeKey: v.string(),
    alertStatus: v.string(),
    severity: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.alertStatus !== "firing") {
      return null;
    }

    const active = await ctx.db
      .query("investigationJobs")
      .withIndex("by_fingerprint_status", (q) =>
        q.eq("fingerprint", args.fingerprint).eq("status", "queued"),
      )
      .first();
    if (active) {
      await ctx.db.patch(active._id, {
        sourceEventId: args.sourceEventId,
        updatedAt: args.now,
      });
      return active._id;
    }

    return await ctx.db.insert("investigationJobs", {
      alertId: args.alertId,
      sourceEventId: args.sourceEventId,
      fingerprint: args.fingerprint,
      dedupeKey: args.dedupeKey,
      status: "queued",
      priority: args.severity === "critical" ? "high" : "normal",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: args.now,
      errorHistory: [],
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const claim = internalMutation({
  args: {
    jobId: v.optional(v.id("investigationJobs")),
    workerId: v.string(),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = args.jobId
      ? await ctx.db.get(args.jobId)
      : await ctx.db
          .query("investigationJobs")
          .withIndex("by_status_nextAttemptAt", (q) =>
            q.eq("status", "queued").lte("nextAttemptAt", args.now),
          )
          .first();

    if (!job || job.status !== "queued" || job.nextAttemptAt > args.now) {
      return null;
    }

    await ctx.db.patch(job._id, {
      status: "claimed",
      claimedBy: args.workerId,
      claimToken: args.claimToken,
      claimedAt: args.now,
      leaseUntil: args.now + args.leaseSeconds * 1000,
      attempts: job.attempts + 1,
      updatedAt: args.now,
    });

    return await ctx.db.get(job._id);
  },
});

export const renew = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "claimed" || job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }
    const leaseUntil = args.now + args.leaseSeconds * 1000;
    await ctx.db.patch(args.id, { leaseUntil, updatedAt: args.now });
    return { leaseUntil };
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "claimed" || job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }
    await ctx.db.patch(args.id, {
      status: "done",
      completedAt: args.now,
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      updatedAt: args.now,
    });
    return { ok: true };
  },
});

export const fail = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.optional(v.string()),
    phase: v.string(),
    error: v.string(),
    retryable: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) {
      throw new Error("job not found");
    }
    if (job.status === "claimed" && job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }

    const errorHistory = [
      ...job.errorHistory,
      { at: args.now, phase: args.phase, error: args.error, retryable: args.retryable },
    ];
    const shouldRetry = args.retryable && job.attempts < job.maxAttempts;
    if (shouldRetry) {
      const delayMs = Math.min(60 * 60 * 1000, 60 * 1000 * 5 ** Math.max(job.attempts - 1, 0));
      await ctx.db.patch(args.id, {
        status: "queued",
        nextAttemptAt: args.now + delayMs,
        claimedBy: undefined,
        claimToken: undefined,
        claimedAt: undefined,
        leaseUntil: undefined,
        lastError: args.error,
        errorHistory,
        updatedAt: args.now,
      });
      return { status: "queued" };
    }

    await ctx.db.patch(args.id, {
      status: "deadletter",
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      lastError: args.error,
      errorHistory,
      deadletteredAt: args.now,
      deadletterReason: args.error,
      updatedAt: args.now,
    });
    return { status: "deadletter" };
  },
});

export const requeue = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "queued",
      nextAttemptAt: args.now,
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      deadletteredAt: undefined,
      deadletterReason: undefined,
      updatedAt: args.now,
    });
    return { ok: true };
  },
});

export const getById = query({
  args: { id: v.id("investigationJobs") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const deadletters = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    return await ctx.db
      .query("investigationJobs")
      .withIndex("by_status_nextAttemptAt", (q) => q.eq("status", "deadletter"))
      .take(limit);
  },
});

export const deadlettersByTimeRange = query({
  args: {
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 500));
    const jobs = await ctx.db
      .query("investigationJobs")
      .withIndex("by_status_nextAttemptAt", (q) => q.eq("status", "deadletter"))
      .take(limit);
    return jobs.filter(
      (job) =>
        job.deadletteredAt !== undefined &&
        job.deadletteredAt >= args.from &&
        job.deadletteredAt <= args.to,
    );
  },
});

export { jobStatusValidator, priorityValidator, errorEntryValidator };
