import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";

export const insert = internalMutation({
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

export const getByTimeRange = internalQuery({
  args: {
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fixes")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", args.from).lte("timestamp", args.to))
      .collect();
  },
});

// The fixes recorded against an alert, newest first, in the shape item responses ship.
// ponytail: scans every fix per alert item; add an alertId index if fixes number thousands.
export async function fixesForAlert(ctx: QueryCtx, alertId: Id<"alerts">) {
  const fixes = await ctx.db.query("fixes").withIndex("by_timestamp").order("desc").collect();
  return fixes
    .filter((fix) => fix.alertIds.includes(alertId))
    .map(({ _id, _creationTime, alertIds, ...fields }) => ({
      ...fields,
      id: String(_id),
      alertIds: alertIds.map(String),
    }));
}

export const getById = internalQuery({
  args: {
    id: v.id("fixes"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("fixes").withIndex("by_timestamp").order("desc").collect();
  },
});

export const deleteById = internalMutation({
  args: { id: v.id("fixes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
