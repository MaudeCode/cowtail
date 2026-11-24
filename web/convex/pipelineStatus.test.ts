import { healthResponseSchema, itemListResponseSchema } from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { type Backend, advance, newBackend, request, rows, stubEnv } from "../test/convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const MINUTE = 60_000;
const SERVICE = "service-token";
const PROMETHEUS = "https://prometheus.test";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({
    PUSH_API_BEARER_TOKEN: SERVICE,
    COWTAIL_ALERTMANAGER_WEBHOOK_TOKEN: "alertmanager-token",
    PROMETHEUS_BASE_URL: PROMETHEUS,
  });
  // /api/health also reads cluster metrics; an empty cluster keeps the response valid.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      if (!String(url).startsWith(`${PROMETHEUS}/api/v1/query`)) {
        throw new Error(`unexpected fetch ${url}`);
      }
      return Response.json({ status: "success", data: { result: [] } });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const watchdog = {
  status: "firing",
  fingerprint: "watchdog-fp",
  startsAt: new Date(NOW - 24 * 60 * MINUTE).toISOString(),
  labels: { alertname: "Watchdog", severity: "none", namespace: "monitoring" },
  annotations: { summary: "An alert that should always be firing" },
};

const crashLoop = {
  status: "firing",
  fingerprint: "crash-fp",
  startsAt: new Date(NOW - MINUTE).toISOString(),
  labels: { alertname: "KubePodCrashLooping", severity: "critical", namespace: "media" },
  annotations: { description: "Pod transcoder restarted 6 times" },
};

async function webhook(t: Backend, alerts: unknown[]) {
  const response = await request(t, "/api/alerts/webhook", {
    method: "POST",
    bearer: "alertmanager-token",
    body: { receiver: "cowtail-investigate", status: "firing", alerts },
  });
  expect(response.status).toBe(200);
}

async function alertPipeline(t: Backend) {
  const response = await request(t, "/api/health");
  expect(response.status).toBe(200);
  return healthResponseSchema.parse(response.json).alertPipeline;
}

async function cowtailItems(t: Backend) {
  const response = await request(t, "/api/items?source=cowtail", { bearer: SERVICE });
  expect(response.status).toBe(200);
  return itemListResponseSchema.parse(response.json).items;
}

test("a Watchdog-only webhook records the heartbeat and creates no alert, item or job", async () => {
  const t = newBackend();

  await webhook(t, [watchdog]);

  expect(await rows(t, "alerts")).toEqual([]);
  expect(await rows(t, "items")).toEqual([]);
  expect(await rows(t, "investigationJobs")).toEqual([]);
  expect(await alertPipeline(t)).toEqual({ state: "ok", lastWatchdogAt: NOW });
});

test("a mixed batch leaves the Watchdog out of its membership", async () => {
  const t = newBackend();

  await webhook(t, [watchdog, crashLoop]);

  const alerts = await rows(t, "alerts");
  expect(alerts.map((alert) => alert.alertname)).toEqual(["KubePodCrashLooping"]);
  const [event] = await rows(t, "alertmanagerEvents");
  expect(event.createdAlertIds).toEqual([alerts[0]._id]);
  expect(event.investigationAlertIds).toEqual([alerts[0]._id]);
  const jobs = await rows(t, "investigationJobs");
  expect(jobs.map((job) => job.alertId)).toEqual([alerts[0]._id]);
  expect(await alertPipeline(t)).toEqual({ state: "ok", lastWatchdogAt: NOW });
});

test("nothing is raised before the first Watchdog arrives", async () => {
  const t = newBackend();

  await advance(t, 60 * MINUTE);

  expect(await rows(t, "items")).toEqual([]);
  expect(await alertPipeline(t)).toEqual({ state: "not_configured" });
});

test("a silent pipeline raises one urgent item that the next Watchdog resolves", async () => {
  const t = newBackend();
  await webhook(t, [watchdog]);

  await advance(t, 14 * MINUTE);
  expect(await rows(t, "items")).toEqual([]);

  await advance(t, MINUTE);
  expect(await alertPipeline(t)).toEqual({ state: "silent", lastWatchdogAt: NOW });
  await advance(t, 10 * MINUTE);
  const raised = await cowtailItems(t);
  expect(raised).toHaveLength(1);
  expect(raised[0]).toMatchObject({
    source: "cowtail",
    kind: "failure",
    urgency: "now",
    state: "open",
    dedupeKey: "cowtail:alert-pipeline-silent",
    title: "Alert pipeline silent",
    occurrenceCount: 1,
  });
  expect(raised[0].body).toContain(new Date(NOW).toISOString());

  await webhook(t, [watchdog]);

  expect(await cowtailItems(t)).toMatchObject([{ id: raised[0].id, state: "resolved" }]);
  expect(await alertPipeline(t)).toEqual({ state: "ok", lastWatchdogAt: NOW + 25 * MINUTE });
});

test("COWTAIL_WATCHDOG_MAX_SILENCE_MINUTES sets the silence threshold", async () => {
  const t = newBackend();
  stubEnv({ COWTAIL_WATCHDOG_MAX_SILENCE_MINUTES: "5" });
  await webhook(t, [watchdog]);

  await advance(t, 4 * MINUTE);
  expect(await rows(t, "items")).toEqual([]);

  await advance(t, MINUTE);
  expect(await cowtailItems(t)).toMatchObject([{ dedupeKey: "cowtail:alert-pipeline-silent" }]);
});
