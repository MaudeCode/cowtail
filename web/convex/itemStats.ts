import {
  itemKinds,
  itemOutcomes,
  type ItemOutcome,
  type ItemStatsResponse,
} from "@maudecode/cowtail-protocol";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { itemOutcome } from "./itemModel";
import { addDaysToDateOnly, dateOnlyForInstant, resolveRoundupWindow } from "./roundup";

const REPEAT_OFFENDER_LIMIT = 10;

// Without a start, the range opens at local midnight six days before its end's day.
export function resolveItemStatsRange(
  range: { from?: number; to?: number },
  now: number,
  timeZone: string,
) {
  const to = range.to ?? now;
  const lastDay = dateOnlyForInstant(new Date(to), timeZone);
  const from =
    range.from ??
    resolveRoundupWindow(addDaysToDateOnly(lastDay, -6), lastDay, timeZone).fromTimestamp;
  return { from, to };
}

// Nearest-rank percentile of an ascending list.
function percentile(sorted: number[], p: number) {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

export const stats = internalQuery({
  args: { from: v.number(), to: v.number(), timeZone: v.string() },
  handler: async (ctx, { from, to, timeZone }): Promise<Omit<ItemStatsResponse, "ok">> => {
    const alerts = new Map<Id<"alerts">, Doc<"alerts"> | null>();
    const alertFor = async (item: Doc<"items">) => {
      if (!item.alertId) return null;
      if (!alerts.has(item.alertId)) alerts.set(item.alertId, await ctx.db.get(item.alertId));
      return alerts.get(item.alertId)!;
    };
    const outcomeFor = async (item: Doc<"items">) =>
      item.state === "resolved" ? itemOutcome(item, await alertFor(item)) : undefined;

    // A resolved item was last updated no earlier than it resolved.
    const resolved = (
      await ctx.db
        .query("items")
        .withIndex("by_state_updatedAt", (q) => q.eq("state", "resolved").gte("updatedAt", from))
        .collect()
    ).filter(
      (item) => item.resolvedAt !== undefined && item.resolvedAt >= from && item.resolvedAt <= to,
    );
    const created = await ctx.db
      .query("items")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", from).lte("createdAt", to))
      .collect();
    const firing = [];
    for (const state of ["open", "acked", "snoozed"] as const) {
      const items = await ctx.db
        .query("items")
        .withIndex("by_state_updatedAt", (q) => q.eq("state", state))
        .collect();
      firing.push(...items.filter((item) => item.kind === "alert"));
    }

    const outcomeMix = Object.fromEntries(itemOutcomes.map((outcome) => [outcome, 0])) as Record<
      ItemOutcome,
      number
    >;
    const durations = new Map<string, number[]>();
    for (const item of resolved) {
      outcomeMix[(await outcomeFor(item))!] += 1;
      const list = durations.get(item.kind) ?? [];
      list.push(item.resolvedAt! - item.createdAt);
      durations.set(item.kind, list);
    }
    const timeToResolve = itemKinds.flatMap((kind) => {
      const list = durations.get(kind)?.sort((a, b) => a - b);
      if (!list) return [];
      return [
        { kind, count: list.length, medianMs: percentile(list, 0.5), p90Ms: percentile(list, 0.9) },
      ];
    });

    // When the item last occurred: its alert's last receipt, or its newest repeat. An owner's
    // ack or snooze moves updatedAt without a new occurrence.
    const lastSeenFor = async (item: Doc<"items">) => {
      const alert = await alertFor(item);
      if (alert) return alert.lastReceivedAt ?? alert.timestamp;
      if (item.occurrenceCount === 1) return item.createdAt;
      const repeat = await ctx.db
        .query("itemEvents")
        .withIndex("by_item_at", (q) => q.eq("itemId", item._id))
        .order("desc")
        .filter((q) => q.eq(q.field("type"), "repeated"))
        .first();
      return repeat?.at ?? item.createdAt;
    };

    const groups = new Map<
      string,
      { title: string; titleAt: number; occurrences: number; noise: number; lastSeenAt: number }
    >();
    for (const item of created) {
      const dedupeKey = item.dedupeKey ?? (await alertFor(item))?.dedupeKey;
      if (!dedupeKey) continue;
      const group = groups.get(dedupeKey) ?? {
        title: item.title,
        titleAt: item.createdAt,
        occurrences: 0,
        noise: 0,
        lastSeenAt: 0,
      };
      group.occurrences += item.occurrenceCount;
      if ((await outcomeFor(item)) === "noise") group.noise += item.occurrenceCount;
      group.lastSeenAt = Math.max(group.lastSeenAt, await lastSeenFor(item));
      if (item.createdAt >= group.titleAt) {
        group.title = item.title;
        group.titleAt = item.createdAt;
      }
      groups.set(dedupeKey, group);
    }
    const repeatOffenders = [...groups]
      .filter(([, group]) => group.occurrences > 1)
      .sort(
        ([keyA, a], [keyB, b]) =>
          b.occurrences - a.occurrences || b.lastSeenAt - a.lastSeenAt || keyA.localeCompare(keyB),
      )
      .slice(0, REPEAT_OFFENDER_LIMIT)
      .map(([dedupeKey, group]) => ({
        dedupeKey,
        title: group.title,
        occurrenceCount: group.occurrences,
        noiseShare: group.noise / group.occurrences,
        lastSeenAt: group.lastSeenAt,
      }));

    // Source names come from producers, so they count in a Map, never on a plain object.
    const days = new Map<string, { total: number; bySource: Map<string, number> }>();
    const lastDay = dateOnlyForInstant(new Date(to), timeZone);
    for (let day = dateOnlyForInstant(new Date(from), timeZone); day <= lastDay;) {
      days.set(day, { total: 0, bySource: new Map() });
      day = addDaysToDateOnly(day, 1);
    }
    for (const item of created) {
      const day = days.get(dateOnlyForInstant(new Date(item.createdAt), timeZone))!;
      day.total += 1;
      day.bySource.set(item.source, (day.bySource.get(item.source) ?? 0) + 1);
    }

    const namespaces = new Map<string, string[]>();
    for (const item of firing) {
      const namespace = (await alertFor(item))?.namespace ?? item.context.namespace ?? "";
      namespaces.set(namespace, [...(namespaces.get(namespace) ?? []), String(item._id)]);
    }
    const firingByNamespace = [...namespaces]
      .map(([namespace, itemIds]) => ({ namespace, count: itemIds.length, itemIds }))
      .sort((a, b) => b.count - a.count || a.namespace.localeCompare(b.namespace));

    return {
      from,
      to,
      timeZone,
      createdCount: created.length,
      resolvedCount: resolved.length,
      outcomeMix,
      noiseRate: resolved.length === 0 ? 0 : outcomeMix.noise / resolved.length,
      timeToResolve,
      repeatOffenders,
      dailyVolume: [...days].map(([date, day]) => ({
        date,
        total: day.total,
        bySource: Object.fromEntries(day.bySource),
      })),
      firingCount: firing.length,
      firingByNamespace,
    };
  },
});
