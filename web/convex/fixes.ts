import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insert = mutation({
  args: {
    timestamp: v.number(),
    alertIds: v.array(v.id("alerts")),
    description: v.string(),
    rootCause: v.string(),
    commit: v.optional(v.string()),
    scope: v.union(v.literal("reactive"), v.literal("weekly"), v.literal("monthly")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("fixes", args);
  },
});

export const getByTimeRange = query({
  args: {
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fixes")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", args.from).lte("timestamp", args.to)
      )
      .collect();
  },
});

export const getByAlertIds = query({
  args: {
    alertIds: v.array(v.id("alerts")),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("fixes").collect();
    return all.filter((fix) =>
      fix.alertIds.some((id) => args.alertIds.includes(id))
    );
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("fixes").withIndex("by_timestamp").order("desc").collect();
  },
});

export const deleteById = mutation({
  args: { id: v.id("fixes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
