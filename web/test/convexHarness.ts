import { createHash } from "node:crypto";

import { makeFunctionReference } from "convex/server";
import { jsonToConvex, type JSONValue } from "convex/values";
import { convexTest } from "convex-test";
import { vi } from "vitest";

import crons from "../convex/crons";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

export type Backend = ReturnType<typeof newBackend>;

export function newBackend() {
  return convexTest(schema, modules);
}

// Restored by `vi.unstubAllEnvs()` in the test's `afterEach`.
export function stubEnv(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    vi.stubEnv(name, value);
  }
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The HTTP layer looks sessions up by the SHA-256 hex of the bearer token.
export async function seedSession(t: Backend, userId: string): Promise<string> {
  const token = `session-${userId}`;
  await t.mutation(internal.authSessions.createSession, {
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

export async function request(
  t: Backend,
  path: string,
  { method = "GET", bearer, body }: { method?: string; bearer?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await t.fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

type CronSpec = {
  name: string;
  args: JSONValue[];
  schedule: { type: string; seconds?: number; minutes?: number; hours?: number };
};

function intervalMs({ schedule }: CronSpec): number | undefined {
  if (schedule.type !== "interval") return undefined;
  return (
    (schedule.seconds ?? 0) * 1_000 +
    (schedule.minutes ?? 0) * 60_000 +
    (schedule.hours ?? 0) * 3_600_000
  );
}

// convex-test runs `ctx.scheduler` work but not `crons.ts`, and every Cowtail retry
// runs from an interval cron. Each interval cron that comes due in the window runs
// through convex-test's scheduler, in time order, at multiples of its interval.
// ponytail: interval crons only; the hourly roundup cron never fires here. Add
// calendar schedules when a test needs one.
export async function advance(t: Backend, ms: number) {
  const end = Date.now() + ms;
  const due: { at: number; cron: CronSpec }[] = [];
  for (const cron of Object.values(crons.crons) as CronSpec[]) {
    const every = intervalMs(cron);
    if (!every) continue;
    for (let at = (Math.floor(Date.now() / every) + 1) * every; at <= end; at += every) {
      due.push({ at, cron });
    }
  }
  due.sort((a, b) => a.at - b.at);

  for (const { at, cron } of due) {
    await t.run(async (ctx) => {
      await ctx.scheduler.runAt(
        at,
        makeFunctionReference<"action">(cron.name),
        jsonToConvex(cron.args[0]) as Record<string, unknown>,
      );
    });
    vi.advanceTimersByTime(at - Date.now());
    await t.finishInProgressScheduledFunctions();
  }
  vi.advanceTimersByTime(end - Date.now());
  await t.finishInProgressScheduledFunctions();
}

type Fields<T extends keyof typeof schema.tables> = Omit<Doc<T>, "_id" | "_creationTime">;

export function alertFields(overrides: Partial<Fields<"alerts">> = {}): Fields<"alerts"> {
  return {
    timestamp: 50,
    alertname: "TestAlert",
    severity: "warning",
    namespace: "test",
    status: "firing",
    outcome: "pending",
    summary: "Original summary",
    action: "Original action",
    messaged: false,
    ...overrides,
  };
}

// Writes rows straight to the tables, as data already stored before the code under test runs.
export async function seedInvestigation(
  t: Backend,
  {
    alerts = [{}],
    job = {},
  }: { alerts?: Partial<Fields<"alerts">>[]; job?: Partial<Fields<"investigationJobs">> } = {},
) {
  return await t.run(async (ctx) => {
    const eventId = await ctx.db.insert("alertmanagerEvents", {
      receivedAt: 40,
      source: "alertmanager",
      status: "firing",
      groupLabels: {},
      commonLabels: {},
      commonAnnotations: {},
      rawPayload: {},
      payloadHash: "hash",
      createdAlertIds: [],
      createdJobIds: [],
      ingestStatus: "normalized",
    });
    const alertIds: Id<"alerts">[] = [];
    for (const overrides of alerts) {
      alertIds.push(
        await ctx.db.insert("alerts", alertFields({ sourceEventId: eventId, ...overrides })),
      );
    }
    await ctx.db.patch(eventId, { createdAlertIds: alertIds, investigationAlertIds: alertIds });
    const jobId = await ctx.db.insert("investigationJobs", {
      alertId: alertIds[0],
      sourceEventId: eventId,
      fingerprint: "fingerprint-1",
      dedupeKey: "dedupe-1",
      status: "claimed",
      priority: "normal",
      claimToken: "claim-1",
      claimedBy: "test-worker",
      claimedAt: 100,
      leaseUntil: 1000,
      attempts: 2,
      maxAttempts: 5,
      nextAttemptAt: 90,
      errorHistory: [],
      createdAt: 50,
      updatedAt: 100,
      ...job,
    });
    return { eventId, alertIds, jobId };
  });
}

export async function rows<T extends keyof typeof schema.tables>(t: Backend, table: T) {
  return (await t.run((ctx) => ctx.db.query(table).collect())) as Doc<T>[];
}

export async function row<T extends keyof typeof schema.tables>(t: Backend, id: Id<T>) {
  return (await t.run((ctx) => ctx.db.get(id))) as Doc<T> | null;
}
