import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insert = mutation({
  args: {
    timestamp: v.number(),
    alertname: v.string(),
    severity: v.string(),
    namespace: v.string(),
    node: v.optional(v.string()),
    status: v.string(),
    outcome: v.string(),
    summary: v.string(),
    action: v.string(),
    rootCause: v.optional(v.string()),
    messaged: v.boolean(),
    resolvedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("alerts", args);
  },
});

export const getByTimeRange = query({
  args: {
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alerts")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", args.from).lte("timestamp", args.to)
      )
      .collect();
  },
});

export const getById = query({
  args: {
    id: v.id("alerts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("alerts").withIndex("by_timestamp").order("desc").collect();
  },
});

export const deleteAll = mutation({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db.query("alerts").collect();
    for (const a of alerts) {
      await ctx.db.delete(a._id);
    }
    return { deleted: alerts.length };
  },
});

export const deleteById = mutation({
  args: { id: v.id("alerts") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
