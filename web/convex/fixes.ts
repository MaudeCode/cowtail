import type { Doc, Id } from "./_generated/dataModel";
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

type FixRecord = Omit<Doc<"fixes">, "_id" | "_creationTime" | "alertIds"> & {
  id: string;
  alertIds: string[];
};

// Every fix grouped by alert, newest first, read once per query however many items it
// serializes.
// ponytail: reads the whole fixes table once per query; index fixes by alert if they number
// thousands.
const fixesByAlertPerQuery = new WeakMap<QueryCtx, Promise<Map<string, FixRecord[]>>>();

async function readFixesByAlert(ctx: QueryCtx) {
  const byAlert = new Map<string, FixRecord[]>();
  const fixes = await ctx.db.query("fixes").withIndex("by_timestamp").order("desc").collect();
  for (const { _id, _creationTime, alertIds, ...fields } of fixes) {
    const record = { ...fields, id: String(_id), alertIds: alertIds.map(String) };
    for (const alertId of record.alertIds) {
      byAlert.set(alertId, [...(byAlert.get(alertId) ?? []), record]);
    }
  }
  return byAlert;
}

// The fixes recorded against an alert, newest first, in the shape item responses ship.
export async function fixesForAlert(ctx: QueryCtx, alertId: Id<"alerts">) {
  let byAlert = fixesByAlertPerQuery.get(ctx);
  if (!byAlert) {
    byAlert = readFixesByAlert(ctx);
    fixesByAlertPerQuery.set(ctx, byAlert);
  }
  return (await byAlert).get(String(alertId)) ?? [];
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
