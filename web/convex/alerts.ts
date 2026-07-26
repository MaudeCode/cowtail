import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  alertLifecycleDedupeKey,
  preservesInvestigationOutcome,
  resolveAlertLifecyclePatch,
} from "./alertLifecycle";
import { resolveInitialAlertDisposition } from "./alertDisposition";

const alertSourceValidator = v.union(
  v.literal("alertmanager"),
  v.literal("hermes"),
  v.literal("manual"),
  v.literal("weekly-review"),
);

function newestAlert(alerts: Doc<"alerts">[]): Doc<"alerts"> {
  return alerts.reduce((newest, alert) =>
    (alert.lastReceivedAt ?? alert._creationTime) > (newest.lastReceivedAt ?? newest._creationTime)
      ? alert
      : newest,
  );
}

function uniqueAlertIds(ids: Id<"alerts">[]): Id<"alerts">[] {
  return [...new Map(ids.map((id) => [String(id), id])).values()];
}

async function mergeLifecycleDocuments(
  ctx: MutationCtx,
  alerts: Doc<"alerts">[],
  dedupeKey: string,
) {
  const ordered = [...alerts].sort((left, right) => left._creationTime - right._creationTime);
  const survivor = ordered[0];
  if (!survivor) throw new Error("No alerts to merge");

  if (ordered.length === 1) {
    return {
      id: survivor._id,
      status: survivor.status,
      outcome: survivor.outcome,
      occurrenceCount: survivor.occurrenceCount ?? 1,
      merged: 0,
    };
  }

  const latest = newestAlert(ordered);
  const resolved = ordered.filter((alert) => alert.status === "resolved");
  const latestResolved = resolved.length > 0 ? newestAlert(resolved) : undefined;
  const outcomeSource = preservesInvestigationOutcome(survivor.outcome)
    ? survivor
    : (ordered.find((alert) => preservesInvestigationOutcome(alert.outcome)) ?? survivor);
  const duplicateIds = new Set(ordered.slice(1).map((alert) => String(alert._id)));

  const jobs = await ctx.db.query("investigationJobs").collect();
  for (const job of jobs) {
    if (duplicateIds.has(String(job.alertId))) {
      await ctx.db.patch(job._id, { alertId: survivor._id, dedupeKey });
    }
  }

  const fixes = await ctx.db.query("fixes").collect();
  for (const fix of fixes) {
    if (!fix.alertIds.some((id) => duplicateIds.has(String(id)))) continue;
    await ctx.db.patch(fix._id, {
      alertIds: uniqueAlertIds(
        fix.alertIds.map((id) => (duplicateIds.has(String(id)) ? survivor._id : id)),
      ),
    });
  }

  const events = await ctx.db.query("alertmanagerEvents").collect();
  for (const event of events) {
    if (!event.createdAlertIds.some((id) => duplicateIds.has(String(id)))) continue;
    await ctx.db.patch(event._id, {
      createdAlertIds: uniqueAlertIds(
        event.createdAlertIds.map((id) => (duplicateIds.has(String(id)) ? survivor._id : id)),
      ),
    });
  }

  const status = latestResolved ? "resolved" : latest.status;
  const mergedOutcome = outcomeSource.outcome;
  const occurrenceCount = ordered.reduce((total, alert) => total + (alert.occurrenceCount ?? 1), 0);

  await ctx.db.patch(survivor._id, {
    timestamp: survivor.startsAt ?? survivor.timestamp,
    alertname: latest.alertname,
    severity: latest.severity,
    namespace: latest.namespace,
    node: latest.node,
    status,
    outcome: mergedOutcome,
    summary: outcomeSource.summary,
    action: outcomeSource.action,
    rootCause: outcomeSource.rootCause,
    messaged: ordered.some((alert) => alert.messaged),
    resolvedAt: latestResolved?.resolvedAt ?? latestResolved?.endsAt,
    source: "alertmanager",
    sourceEventId: latest.sourceEventId,
    alertmanagerFingerprint: survivor.alertmanagerFingerprint,
    dedupeKey,
    startsAt: survivor.startsAt,
    endsAt: latestResolved?.endsAt,
    generatorURL: latest.generatorURL,
    labels: latest.labels,
    annotations: latest.annotations,
    lastReceivedAt: latest.lastReceivedAt,
    occurrenceCount,
  });

  for (const duplicate of ordered.slice(1)) {
    await ctx.db.delete(duplicate._id);
  }

  return {
    id: survivor._id,
    status,
    outcome: mergedOutcome,
    occurrenceCount,
    merged: ordered.length - 1,
  };
}

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
  handler: async (ctx, args) => await ctx.db.insert("alerts", args),
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
    investigationPending: v.boolean(),
    summary: v.string(),
    labels: v.record(v.string(), v.any()),
    annotations: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const disposition = resolveInitialAlertDisposition(args.status, args.investigationPending);
    const matches = await ctx.db
      .query("alerts")
      .withIndex("by_fingerprint_startsAt", (q) =>
        q.eq("alertmanagerFingerprint", args.alertmanagerFingerprint).eq("startsAt", args.startsAt),
      )
      .collect();

    const lifecycle =
      matches.length > 0 ? await mergeLifecycleDocuments(ctx, matches, args.dedupeKey) : undefined;
    const existing = lifecycle ? await ctx.db.get(lifecycle.id) : null;

    const receivedPatch = {
      timestamp: args.timestamp,
      alertname: args.alertname,
      severity: args.severity,
      namespace: args.namespace,
      node: args.node,
      source: "alertmanager" as const,
      sourceEventId: args.sourceEventId,
      alertmanagerFingerprint: args.alertmanagerFingerprint,
      dedupeKey: args.dedupeKey,
      startsAt: args.startsAt,
      generatorURL: args.generatorURL,
      labels: args.labels,
      annotations: args.annotations,
      lastReceivedAt: now,
    };

    if (existing && lifecycle) {
      await ctx.db.patch(existing._id, {
        ...receivedPatch,
        ...resolveAlertLifecyclePatch(existing, args, disposition),
        occurrenceCount: lifecycle.occurrenceCount + 1,
      });
      return existing._id;
    }

    return await ctx.db.insert("alerts", {
      ...receivedPatch,
      status: args.status,
      outcome: disposition.outcome,
      summary: args.summary,
      action: disposition.action,
      messaged: false,
      resolvedAt: args.status === "resolved" ? args.endsAt : undefined,
      endsAt: args.endsAt,
      occurrenceCount: 1,
    });
  },
});

export const listLifecycleDuplicateGroups = internalQuery({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db.query("alerts").collect();
    const groups = new Map<string, Doc<"alerts">[]>();

    for (const alert of alerts) {
      if (alert.source !== "alertmanager" || !alert.alertmanagerFingerprint) {
        continue;
      }
      const key = alertLifecycleDedupeKey(alert.alertmanagerFingerprint, alert.startsAt);
      groups.set(key, [...(groups.get(key) ?? []), alert]);
    }

    return [...groups.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([dedupeKey, group]) => ({
        dedupeKey,
        fingerprint: group[0]?.alertmanagerFingerprint,
        startsAt: group[0]?.startsAt,
        alertIds: group.map((alert) => alert._id),
        count: group.length,
      }));
  },
});

export const mergeLifecycleDuplicateGroup = internalMutation({
  args: {
    fingerprint: v.string(),
    startsAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_fingerprint_startsAt", (q) =>
        q.eq("alertmanagerFingerprint", args.fingerprint).eq("startsAt", args.startsAt),
      )
      .collect();
    const dedupeKey = alertLifecycleDedupeKey(args.fingerprint, args.startsAt);
    const result = await mergeLifecycleDocuments(ctx, alerts, dedupeKey);
    return { ok: true, survivorId: result.id, merged: result.merged };
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
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("alerts")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", args.from).lte("timestamp", args.to))
      .collect(),
});

export const getById = query({
  args: { id: v.id("alerts") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const getAll = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query("alerts").withIndex("by_timestamp").order("desc").collect(),
});

export const deleteAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db.query("alerts").collect();
    for (const alert of alerts) await ctx.db.delete(alert._id);
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
