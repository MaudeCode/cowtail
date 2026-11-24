import type { MaintenanceMatcher, MaintenanceWindowRecord } from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { itemSourceNames } from "./items";
import { WATCHDOG_ALERTNAME } from "./pipelineStatus";

// A window names `alertmanager` among its sources to cover every alert.
const ALL_ALERTS_SOURCES = new Set(["alertmanager", "*"]);
const RECENT_LIMIT = 20;

type Window = Doc<"maintenanceWindows">;

export function windowRecord(window: Window, now: number): MaintenanceWindowRecord {
  const { _id, _creationTime, requestId: _requestId, ...fields } = window;
  return {
    ...fields,
    id: String(_id),
    allAlerts: window.sources.some((source) => ALL_ALERTS_SOURCES.has(source)),
    heldSources: window.sources.filter((source) => source !== "alertmanager"),
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
    requestId: v.optional(v.string()),
    now: v.number(),
  },
  // A repeat of a request already started returns its window, so a client may retry a start
  // whose reply it lost without making a second window.
  handler: async (ctx, { durationMs, sources, now, ...fields }) => {
    const { requestId } = fields;
    const repeated = requestId
      ? await ctx.db
          .query("maintenanceWindows")
          .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
          .first()
      : null;
    if (repeated) return { window: windowRecord(repeated, now), repeated: true };
    const id = await ctx.db.insert("maintenanceWindows", {
      ...fields,
      // A window that names nothing covers all alerts.
      sources: sources.length === 0 && fields.matchers.length === 0 ? ["alertmanager"] : sources,
      startsAt: now,
      endsAt: now + durationMs,
      silenceIds: [],
    });
    return { window: windowRecord(requireWindow(await ctx.db.get(id)), now), repeated: false };
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
 * retried request is safe. Its silences are expireWindowSilences' to remove.
 */
export const end = internalMutation({
  args: { id: v.string(), now: v.number() },
  handler: async (ctx, { id, now }) => {
    const windowId = ctx.db.normalizeId("maintenanceWindows", id);
    const window = requireWindow(windowId ? await ctx.db.get(windowId) : null);
    if (windowRecord(window, now).active) await ctx.db.patch(window._id, { endedAt: now });
    return windowRecord(requireWindow(await ctx.db.get(window._id)), now);
  },
});

// A window ended early still holds silences until Cowtail expires them; past its end they
// expire in Alertmanager by themselves.
function silencesToExpire(window: Window, now: number) {
  return window.endedAt !== undefined && window.endsAt > now ? window.silenceIds : [];
}

export const leftoverSilences = internalQuery({
  args: { id: v.id("maintenanceWindows"), now: v.number() },
  handler: async (ctx, { id, now }) => silencesToExpire(requireWindow(await ctx.db.get(id)), now),
});

export const windowsWithLeftoverSilences = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const running = await ctx.db
      .query("maintenanceWindows")
      .withIndex("by_endsAt", (q) => q.gt("endsAt", now))
      .collect();
    return running.filter((window) => silencesToExpire(window, now).length > 0).map((w) => w._id);
  },
});

// The silences Alertmanager expired leave the window; an error says why the rest stay.
export const settleSilences = internalMutation({
  args: {
    id: v.id("maintenanceWindows"),
    expired: v.array(v.string()),
    silenceError: v.optional(v.string()),
  },
  handler: async (ctx, { id, expired, silenceError }) => {
    const window = requireWindow(await ctx.db.get(id));
    await ctx.db.patch(id, {
      silenceIds: window.silenceIds.filter((silenceId) => !expired.includes(silenceId)),
      silenceError,
    });
  },
});

const leftoverSilencesRef = makeFunctionReference<
  "query",
  { id: Id<"maintenanceWindows">; now: number },
  string[]
>("maintenance:leftoverSilences");
const windowsWithLeftoverSilencesRef = makeFunctionReference<
  "query",
  { now: number },
  Id<"maintenanceWindows">[]
>("maintenance:windowsWithLeftoverSilences");
const settleSilencesRef = makeFunctionReference<
  "mutation",
  { id: Id<"maintenanceWindows">; expired: string[]; silenceError?: string }
>("maintenance:settleSilences");

/**
 * Expires the silences a window ended early still holds. The end request, a start whose
 * window ended while its silence was being made, and a retry every minute all run it, so a
 * silence Alertmanager could not expire is removed once it answers again.
 */
export async function expireWindowSilences(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  id: Id<"maintenanceWindows">,
) {
  const silenceIds = await ctx.runQuery(leftoverSilencesRef, { id, now: Date.now() });
  if (silenceIds.length === 0) return;
  const { expired, error } = await expireSilences(silenceIds);
  await ctx.runMutation(settleSilencesRef, { id, expired, silenceError: error });
}

// Runs every minute.
export const expireLeftoverSilences = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const id of await ctx.runQuery(windowsWithLeftoverSilencesRef, { now: Date.now() })) {
      await expireWindowSilences(ctx, id);
    }
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
      // All alerts is a scope of its own, so Alertmanager is no source choice.
      sourceChoices: (await itemSourceNames(ctx)).filter((source) => source !== "alertmanager"),
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

// Equality matchers ANDed together; a window over all alerts matches any alertname. No
// silence takes the Watchdog: it is how Cowtail knows the alert pipeline works.
function silenceMatchers(record: MaintenanceWindowRecord) {
  const scope = record.allAlerts
    ? [{ name: "alertname", value: ".+", isRegex: true, isEqual: true }]
    : record.matchers.map(({ label, value }: MaintenanceMatcher) => ({
        name: label,
        value,
        isRegex: false,
        isEqual: true,
      }));
  return [
    ...scope,
    { name: "alertname", value: WATCHDOG_ALERTNAME, isRegex: false, isEqual: false },
  ];
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

/** The silences Alertmanager expired, and the error of the first that it did not. */
async function expireSilences(silenceIds: string[]) {
  const expired: string[] = [];
  let error: string | undefined;
  for (const id of silenceIds) {
    try {
      await alertmanager(`/api/v2/silence/${encodeURIComponent(id)}`, { method: "DELETE" });
      expired.push(id);
    } catch (failure) {
      error ??= `Could not end the Alertmanager silence: ${(failure as Error).message}`;
    }
  }
  return { expired, error };
}
