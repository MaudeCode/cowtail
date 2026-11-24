import {
  maintenanceWindowListResponseSchema,
  maintenanceWindowResponseSchema,
} from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { type Backend, newBackend, request, stubEnv } from "../test/convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const HOUR = 60 * 60_000;
const SERVICE = "service-token";
const ALERTMANAGER = "https://alertmanager.test";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({
    PUSH_API_BEARER_TOKEN: SERVICE,
    COWTAIL_WORKER_TOKEN: "worker-token",
    ALERTMANAGER_BASE_URL: ALERTMANAGER,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Call = { method: string; path: string; body: unknown };

// Alertmanager's v2 silence API: it records each request and answers `status`, refusing any
// other URL.
function fakeAlertmanager(status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url).slice(ALERTMANAGER.length);
      if (!String(url).startsWith(`${ALERTMANAGER}/api/v2/silence`)) {
        throw new Error(`unexpected fetch ${url}`);
      }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method: init?.method ?? "GET", path, body });
      if (status !== 200) return new Response("down", { status });
      return init?.method === "POST" ? Response.json({ silenceID: "silence-1" }) : new Response();
    }),
  );
  return calls;
}

async function start(t: Backend, body: Record<string, unknown>) {
  const response = await request(t, "/api/me/maintenance-windows", {
    method: "POST",
    bearer: SERVICE,
    body: { title: "Cluster upgrade", durationMs: HOUR, ...body },
  });
  expect(response.status).toBe(200);
  return maintenanceWindowResponseSchema.parse(response.json).window;
}

test("Hermes's worker token cannot start a window", async () => {
  const calls = fakeAlertmanager();
  const response = await request(newBackend(), "/api/me/maintenance-windows", {
    method: "POST",
    bearer: "worker-token",
    body: { title: "Cluster upgrade", durationMs: HOUR },
  });

  expect([response.status, calls]).toEqual([401, []]);
});

describe("maintenance window silences", () => {
  test("starting a window silences its matchers in Alertmanager for its time", async () => {
    const calls = fakeAlertmanager();
    const window = await start(newBackend(), {
      matchers: [{ label: "namespace", value: "media" }],
    });

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/v2/silences",
        body: {
          matchers: [{ name: "namespace", value: "media", isRegex: false, isEqual: true }],
          startsAt: new Date(NOW).toISOString(),
          endsAt: new Date(NOW + HOUR).toISOString(),
          createdBy: "cowtail",
          comment: "Cluster upgrade",
        },
      },
    ]);
    expect(window).toMatchObject({ active: true, allAlerts: false, silenceIds: ["silence-1"] });
  });

  test("a window that names nothing silences every alert", async () => {
    const calls = fakeAlertmanager();
    const window = await start(newBackend(), {});

    expect(window).toMatchObject({ sources: ["alertmanager"], allAlerts: true });
    expect(calls.map((call) => (call.body as { matchers: unknown }).matchers)).toEqual([
      [{ name: "alertname", value: ".+", isRegex: true, isEqual: true }],
    ]);
  });

  test("ending a window early expires its silence and lists it as over", async () => {
    const calls = fakeAlertmanager();
    const backend = newBackend();
    const window = await start(backend, {});
    vi.advanceTimersByTime(10 * 60_000);

    const ended = await request(backend, `/api/me/maintenance-windows/${window.id}/end`, {
      method: "POST",
      bearer: SERVICE,
    });
    expect(ended.status).toBe(200);
    expect(maintenanceWindowResponseSchema.parse(ended.json).window).toMatchObject({
      active: false,
      endedAt: NOW + 10 * 60_000,
    });
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/v2/silences",
      "DELETE /api/v2/silence/silence-1",
    ]);

    const list = maintenanceWindowListResponseSchema.parse(
      (await request(backend, "/api/me/maintenance-windows", { bearer: SERVICE })).json,
    );
    expect([list.active, list.recent.map((entry) => entry.id)]).toEqual([[], [window.id]]);
  });

  test("a window starts with silenceError when Alertmanager refuses the silence", async () => {
    fakeAlertmanager(503);
    const window = await start(newBackend(), {});

    expect(window).toMatchObject({
      active: true,
      silenceIds: [],
      silenceError: "Alertmanager answered 503",
    });
  });

  test("a window starts with silenceError when no Alertmanager is configured", async () => {
    vi.stubEnv("ALERTMANAGER_BASE_URL", "");
    const calls = fakeAlertmanager();
    const window = await start(newBackend(), {});

    expect(window).toMatchObject({
      active: true,
      silenceError: "ALERTMANAGER_BASE_URL is not set",
    });
    expect(calls).toEqual([]);
  });
});
