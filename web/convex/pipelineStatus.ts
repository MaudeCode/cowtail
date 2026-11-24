import type { AlertPipelineStatus } from "@maudecode/cowtail-protocol";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { createItem, openItemByDedupeKey, transitionItem } from "./items";

// kube-prometheus-stack's always-firing dead-man's switch. Alertmanager re-sends it on each
// `repeat_interval`, so its silence means the Prometheus → Alertmanager → Cowtail path broke.
export const WATCHDOG_ALERTNAME = "Watchdog";
const SILENT_DEDUPE_KEY = "cowtail:alert-pipeline-silent";
const DEFAULT_MAX_SILENCE_MINUTES = 15;

function maxSilenceMs(): number {
  const minutes = Number(process.env.COWTAIL_WATCHDOG_MAX_SILENCE_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MAX_SILENCE_MINUTES) * 60_000;
}

async function pipelineRow(ctx: QueryCtx) {
  return await ctx.db.query("pipelineStatus").first();
}

function pipelineState(row: Doc<"pipelineStatus"> | null, now: number): AlertPipelineStatus {
  if (!row) return { state: "not_configured" };
  return {
    state: now - row.lastWatchdogAt >= maxSilenceMs() ? "silent" : "ok",
    lastWatchdogAt: row.lastWatchdogAt,
  };
}

export const get = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => pipelineState(await pipelineRow(ctx), now),
});

export const recordWatchdog = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const row = await pipelineRow(ctx);
    if (row) {
      await ctx.db.patch(row._id, { lastWatchdogAt: now });
    } else {
      await ctx.db.insert("pipelineStatus", { firstWatchdogAt: now, lastWatchdogAt: now });
    }

    const silent = await openItemByDedupeKey(ctx, "cowtail", SILENT_DEDUPE_KEY);
    if (silent) {
      await transitionItem(ctx, silent, "resolved", {
        actor: "cowtail",
        at: now,
        payload: { reason: "Watchdog resumed" },
      });
    }
  },
});

// Runs every minute from crons.ts.
export const checkSilence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const row = await pipelineRow(ctx);
    if (pipelineState(row, now).state !== "silent") return;
    if (await openItemByDedupeKey(ctx, "cowtail", SILENT_DEDUPE_KEY)) return;

    await createItem(
      ctx,
      {
        source: "cowtail",
        kind: "failure",
        urgency: "now",
        dedupeKey: SILENT_DEDUPE_KEY,
        title: "Alert pipeline silent",
        body: `No Alertmanager Watchdog has reached Cowtail since ${new Date(row!.lastWatchdogAt).toISOString()}. Alerts may not be arriving: check Prometheus, Alertmanager and its route to the Cowtail webhook.`,
      },
      now,
    );
  },
});
