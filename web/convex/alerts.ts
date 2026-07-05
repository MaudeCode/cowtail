import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const alertSourceValidator = v.union(
  v.literal("alertmanager"),
  v.literal("hermes"),
  v.literal("manual"),
  v.literal("weekly-review"),
);

export const insert = internalMutation({
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
    source: v.optional(alertSourceValidator),
    sourceEventId: v.optional(v.id("alertmanagerEvents")),
    alertmanagerFingerprint: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    generatorURL: v.optional(v.string()),
    labels: v.optional(v.record(v.string(), v.any())),
    annotations: v.optional(v.record(v.string(), v.any())),
    lastReceivedAt: v.optional(v.number()),
    occurrenceCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("alerts", args);
  },
});

export const upsertFromAlertmanager = internalMutation({
  args: {
    sourceEventId: v.id("alertmanagerEvents"),
    dedupeKey: v.string(),
    alertmanagerFingerprint: v.string(),
    timestamp: v.number(),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    generatorURL: v.optional(v.string()),
    alertname: v.string(),
    severity: v.string(),
    namespace: v.string(),
    node: v.optional(v.string()),
    status: v.string(),
    summary: v.string(),
    labels: v.record(v.string(), v.any()),
    annotations: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("alerts")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
      .unique();

    const patch = {
      source: "alertmanager" as const,
      sourceEventId: args.sourceEventId,
      alertmanagerFingerprint: args.alertmanagerFingerprint,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      generatorURL: args.generatorURL,
      labels: args.labels,
      annotations: args.annotations,
      lastReceivedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...patch,
        occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
      });
      return existing._id;
    }

    return await ctx.db.insert("alerts", {
      timestamp: args.timestamp,
      alertname: args.alertname,
      severity: args.severity,
      namespace: args.namespace,
      node: args.node,
      status: args.status,
      outcome: "pending",
      summary: args.summary,
      action: "Recorded by Cowtail Alertmanager ingest. Investigation pending.",
      messaged: false,
      resolvedAt: args.endsAt,
      dedupeKey: args.dedupeKey,
      occurrenceCount: 1,
      ...patch,
    });
  },
});

export const updateOutcome = internalMutation({
  args: {
    id: v.id("alerts"),
    outcome: v.string(),
    summary: v.string(),
    action: v.string(),
    rootCause: v.optional(v.string()),
    messaged: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      outcome: args.outcome,
      summary: args.summary,
      action: args.action,
      rootCause: args.rootCause,
      messaged: args.messaged,
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
      .query("alerts")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", args.from).lte("timestamp", args.to))
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

export const deleteAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db.query("alerts").collect();
    for (const a of alerts) {
      await ctx.db.delete(a._id);
    }
    return { deleted: alerts.length };
  },
});

export const deleteById = internalMutation({
  args: { id: v.id("alerts") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
