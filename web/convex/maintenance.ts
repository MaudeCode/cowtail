import type { MaintenanceMatcher, MaintenanceWindowRecord } from "@maudecode/cowtail-protocol";
import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

// A window names `alertmanager` among its sources to cover every alert.
const ALL_ALERTS_SOURCES = new Set(["alertmanager", "*"]);
const RECENT_LIMIT = 20;

type Window = Doc<"maintenanceWindows">;

export function windowRecord(window: Window, now: number): MaintenanceWindowRecord {
  const { _id, _creationTime, ...fields } = window;
  return {
    ...fields,
    id: String(_id),
    allAlerts: window.sources.some((source) => ALL_ALERTS_SOURCES.has(source)),
    active: window.endedAt === undefined && window.startsAt <= now && now < window.endsAt,
  };
}

async function activeWindows(ctx: QueryCtx, now: number) {
  const running = await ctx.db
    .query("maintenanceWindows")
    .withIndex("by_endsAt", (q) => q.gt("endsAt", now))
    .collect();
  return running.filter((window) => windowRecord(window, now).active);
}

type CoveredItem = Pick<Doc<"items">, "source" | "urgency" | "alertId">;

/**
 * The running window that covers the item, if any: by its source, or for an Alertmanager
 * alert by its labels. Cowtail's own `now` items, its watchdogs, are never covered.
 */
export async function coveringWindow(
  ctx: QueryCtx,
  item: CoveredItem,
  now: number,
): Promise<Window | undefined> {
  if (item.source === "cowtail" && item.urgency === "now") return undefined;
  const windows = await activeWindows(ctx, now);
  if (windows.length === 0) return undefined;
  const labels = await alertLabels(ctx, item);
  return windows.find(
    (window) =>
      window.sources.includes("*") ||
      window.sources.includes(item.source) ||
      (labels !== undefined &&
        window.matchers.length > 0 &&
        window.matchers.every(({ label, value }) => labels[label] === value)),
  );
}

async function alertLabels(ctx: QueryCtx, item: CoveredItem) {
  if (item.source !== "alertmanager" || !item.alertId) return undefined;
  const alert = await ctx.db.get(item.alertId);
  if (!alert) return undefined;
  const labels: Record<string, string> = {
    alertname: alert.alertname,
    namespace: alert.namespace,
  };
  for (const [key, value] of Object.entries(alert.labels ?? {})) {
    if (typeof value === "string") labels[key] = value;
  }
  return labels;
}

function requireWindow(window: Window | null): Window {
  if (!window) throw new ConvexError({ code: "MAINTENANCE_WINDOW_NOT_FOUND" });
  return window;
}

const matcherValidator = v.object({ label: v.string(), value: v.string() });

export const start = internalMutation({
  args: {
    title: v.string(),
    durationMs: v.number(),
    matchers: v.array(matcherValidator),
    sources: v.array(v.string()),
    createdBy: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { durationMs, sources, now, ...fields }) => {
    const id = await ctx.db.insert("maintenanceWindows", {
      ...fields,
      // A window that names nothing covers all alerts.
      sources: sources.length === 0 && fields.matchers.length === 0 ? ["alertmanager"] : sources,
      startsAt: now,
      endsAt: now + durationMs,
      silenceIds: [],
    });
    return windowRecord(requireWindow(await ctx.db.get(id)), now);
  },
});

export const recordSilence = internalMutation({
  args: {
    id: v.id("maintenanceWindows"),
    silenceIds: v.optional(v.array(v.string())),
    silenceError: v.optional(v.string()),
  },
  handler: async (ctx, { id, silenceIds, silenceError }) => {
    const window = requireWindow(await ctx.db.get(id));
    await ctx.db.patch(id, {
      silenceIds: [...window.silenceIds, ...(silenceIds ?? [])],
      silenceError,
    });
  },
});

/**
 * Ends a running window now. Ending a window that is already over changes nothing, so a
 * retried request is safe; only the call that ends it returns the silences to expire.
 */
export const end = internalMutation({
  args: { id: v.string(), now: v.number() },
  handler: async (ctx, { id, now }) => {
    const windowId = ctx.db.normalizeId("maintenanceWindows", id);
    const window = requireWindow(windowId ? await ctx.db.get(windowId) : null);
    if (!windowRecord(window, now).active) {
      return { window: windowRecord(window, now), silenceIds: [] };
    }
    await ctx.db.patch(window._id, { endedAt: now });
    const ended = requireWindow(await ctx.db.get(window._id));
    return { window: windowRecord(ended, now), silenceIds: window.silenceIds };
  },
});

export const get = internalQuery({
  args: { id: v.id("maintenanceWindows"), now: v.number() },
  handler: async (ctx, { id, now }) => windowRecord(requireWindow(await ctx.db.get(id)), now),
});

export const list = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const active = (await activeWindows(ctx, now)).sort((a, b) => a.endsAt - b.endsAt);
    // ponytail: the newest windows by start stand in for the ones that were over most
    // recently; index when each was over if an early end must sort first.
    const started = await ctx.db
      .query("maintenanceWindows")
      .order("desc")
      .take(RECENT_LIMIT + active.length);
    const over = started
      .filter((window) => !windowRecord(window, now).active)
      .slice(0, RECENT_LIMIT);
    return {
      active: active.map((window) => windowRecord(window, now)),
      recent: over.map((window) => windowRecord(window, now)),
    };
  },
});

// --- Alertmanager --------------------------------------------------------------------
// Convex reaches Alertmanager's v2 API from inside the cluster; the web origin never
// proxies it.

const ALERTMANAGER_TIMEOUT_MS = 10_000;

function alertmanagerBaseUrl() {
  return process.env.ALERTMANAGER_BASE_URL?.trim().replace(/\/+$/, "") || undefined;
}

// Equality matchers ANDed together; a window over all alerts matches any alertname.
function silenceMatchers(record: MaintenanceWindowRecord) {
  if (record.allAlerts) {
    return [{ name: "alertname", value: ".+", isRegex: true, isEqual: true }];
  }
  return record.matchers.map(({ label, value }: MaintenanceMatcher) => ({
    name: label,
    value,
    isRegex: false,
    isEqual: true,
  }));
}

async function alertmanager(path: string, init: RequestInit) {
  const base = alertmanagerBaseUrl();
  if (!base) throw new Error("ALERTMANAGER_BASE_URL is not set");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(ALERTMANAGER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Alertmanager is unreachable: ${(error as Error).message}`);
  }
  if (!response.ok) throw new Error(`Alertmanager answered ${response.status}`);
  return response;
}

/** Silences the window's alerts. A window over sources alone needs no silence. */
export async function silenceWindow(
  record: MaintenanceWindowRecord,
): Promise<{ silenceIds?: string[]; silenceError?: string } | undefined> {
  if (!record.allAlerts && record.matchers.length === 0) return undefined;
  try {
    const response = await alertmanager("/api/v2/silences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matchers: silenceMatchers(record),
        startsAt: new Date(record.startsAt).toISOString(),
        endsAt: new Date(record.endsAt).toISOString(),
        createdBy: "cowtail",
        comment: record.title,
      }),
    });
    const body = (await response.json().catch(() => null)) as { silenceID?: unknown } | null;
    if (typeof body?.silenceID !== "string") {
      throw new Error("Alertmanager sent no silence id");
    }
    return { silenceIds: [body.silenceID] };
  } catch (error) {
    return { silenceError: (error as Error).message };
  }
}

/** Expires the silences of a window ended early; the error of the first that failed. */
export async function expireSilences(silenceIds: string[]): Promise<string | undefined> {
  let failed: string | undefined;
  for (const id of silenceIds) {
    try {
      await alertmanager(`/api/v2/silence/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (error) {
      failed ??= `Could not end the Alertmanager silence: ${(error as Error).message}`;
    }
  }
  return failed;
}
