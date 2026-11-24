import { createHash } from "node:crypto";

import { makeFunctionReference } from "convex/server";
import { jsonToConvex, type JSONValue } from "convex/values";
import { convexTest } from "convex-test";
import { vi } from "vitest";

import crons from "../convex/crons";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

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
