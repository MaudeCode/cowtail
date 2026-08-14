import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insertStored = internalMutation({
  args: {
    receivedAt: v.number(),
    receiver: v.optional(v.string()),
    status: v.string(),
    groupKey: v.optional(v.string()),
    groupLabels: v.record(v.string(), v.any()),
    externalURL: v.optional(v.string()),
    version: v.optional(v.string()),
    truncatedAlerts: v.optional(v.number()),
    commonLabels: v.record(v.string(), v.any()),
    commonAnnotations: v.record(v.string(), v.any()),
    rawPayload: v.any(),
    payloadHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("alertmanagerEvents", {
      ...args,
      source: "alertmanager",
      createdAlertIds: [],
      createdJobIds: [],
      ingestStatus: "stored",
    });
  },
});

export const markNormalized = internalMutation({
  args: {
    id: v.id("alertmanagerEvents"),
    createdAlertIds: v.array(v.id("alerts")),
    createdJobIds: v.array(v.id("investigationJobs")),
    investigationAlertIds: v.array(v.id("alerts")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      createdAlertIds: args.createdAlertIds,
      createdJobIds: args.createdJobIds,
      investigationAlertIds: args.investigationAlertIds,
      ingestStatus: "normalized",
      error: undefined,
    });
    return { ok: true };
  },
});

export const markJobsCreated = internalMutation({
  args: {
    id: v.id("alertmanagerEvents"),
    createdJobIds: v.array(v.id("investigationJobs")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { createdJobIds: args.createdJobIds });
    return { ok: true };
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("alertmanagerEvents"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      ingestStatus: "failed",
      error: args.error,
    });
    return { ok: true };
  },
});

export const getByTimeRange = query({
  args: {
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alertmanagerEvents")
      .withIndex("by_receivedAt", (q) => q.gte("receivedAt", args.from).lte("receivedAt", args.to))
      .collect();
  },
});

export const getById = query({
  args: {
    id: v.id("alertmanagerEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
