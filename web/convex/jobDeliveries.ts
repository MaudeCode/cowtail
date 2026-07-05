import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const deliveryTargetValidator = v.literal("hermes:cowtail-alert-job");
const deliveryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
);

export const enqueue = internalMutation({
  args: {
    jobId: v.id("investigationJobs"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jobDeliveries")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .first();
    if (existing && existing.status !== "delivered") {
      await ctx.db.patch(existing._id, {
        status: "pending",
        nextAttemptAt: args.now,
        updatedAt: args.now,
      });
      return existing._id;
    }

    return await ctx.db.insert("jobDeliveries", {
      jobId: args.jobId,
      target: "hermes:cowtail-alert-job",
      status: "pending",
      attempts: 0,
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

    if (args.ok) {
      await ctx.db.patch(args.id, {
        status: "delivered",
        attempts: delivery.attempts + 1,
        lastAttemptAt: args.now,
        lastStatusCode: args.statusCode,
        lastError: undefined,
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

export const getById = query({
  args: { id: v.id("jobDeliveries") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export { deliveryTargetValidator, deliveryStatusValidator };
