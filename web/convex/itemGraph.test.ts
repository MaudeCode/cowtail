import { itemGraphResponseSchema } from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Doc } from "./_generated/dataModel";
import { splitThreshold } from "./itemGraph";
import { type Backend, alertFields, newBackend, request, stubEnv } from "../test/convexHarness";

describe("splitThreshold", () => {
  test.each([
    ["foo > 0.9", { query: "foo", threshold: { op: ">", value: 0.9 } }],
    ["rate(x[5m]) >= 10", { query: "rate(x[5m])", threshold: { op: ">=", value: 10 } }],
    [
      'sum(up{job!="a>b"}) by (job) != 1',
      { query: 'sum(up{job!="a>b"}) by (job)', threshold: { op: "!=", value: 1 } },
    ],
    ["a > b", { query: "a > b" }],
    ["(a > 1) and b", { query: "(a > 1) and b" }],
    ["a > 1 and b", { query: "a > 1 and b" }],
    ["a > 1e999", { query: "a > 1e999" }],
    ["", { query: "" }],
  ])("%j", (expr, split) => {
    expect(splitThreshold(expr)).toEqual(split);
  });
});

const WORKER = "worker-token";
const PROMETHEUS = "https://prometheus.test";
const NOW = Date.UTC(2026, 10, 24, 10, 0);
const HOUR = 60 * 60 * 1000;

// The generated api predates this module; Convex resolves it by name.
const backfillAlertItems = makeFunctionReference<"mutation", { cursor?: string | null }>(
  "items:backfillAlertItems",
);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({ COWTAIL_WORKER_TOKEN: WORKER, PROMETHEUS_BASE_URL: PROMETHEUS });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type AlertSeed = Partial<Omit<Doc<"alerts">, "_id" | "_creationTime">>;

const graphUrl = (expr: string) =>
  `http://prometheus.example/graph?g0.expr=${encodeURIComponent(expr)}&g0.tab=1`;

// The item of one stored alert, by its ID.
async function seedAlertItem(t: Backend, seed: AlertSeed) {
  const alertId = await t.run((ctx) => ctx.db.insert("alerts", alertFields(seed)));
  await t.mutation(backfillAlertItems, {});
  const item = await t.run((ctx) =>
    ctx.db
      .query("items")
      .withIndex("by_alertId", (q) => q.eq("alertId", alertId))
      .first(),
  );
  return item!._id;
}

// Prometheus answers range queries only; every request is recorded.
function stubPrometheus(answer: () => Response) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      const parsed = new URL(String(url));
      if (`${parsed.origin}${parsed.pathname}` !== `${PROMETHEUS}/api/v1/query_range`) {
        throw new Error(`unexpected fetch ${url}`);
      }
      calls.push(parsed);
      return answer();
    }),
  );
  return calls;
}

const rangeResult = (series: number, points: number) =>
  Response.json({
    status: "success",
    data: {
      resultType: "matrix",
      result: Array.from({ length: series }, (_, index) => ({
        metric: { pod: `pod-${index}` },
        values: Array.from({ length: points }, (_, at) => [NOW / 1000 - at * 60, String(at)]),
      })),
    },
  });

async function graph(t: Backend, itemId: string, range?: string) {
  const query = range ? `?range=${range}` : "";
  const response = await request(t, `/api/items/${itemId}/graph${query}`, { bearer: WORKER });
  expect(response.status).toBe(200);
  return itemGraphResponseSchema.parse(response.json);
}

test("graph queries the expression's left side at a 120th of the range, ending now", async () => {
  const t = newBackend();
  const itemId = await seedAlertItem(t, {
    generatorURL: graphUrl("container_memory_working_set_bytes > 536870912"),
    startsAt: NOW - HOUR,
  });
  const calls = stubPrometheus(() => rangeResult(1, 3));

  const body = await graph(t, itemId, "1h");

  expect(calls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
    {
      query: "container_memory_working_set_bytes",
      start: String((NOW - HOUR) / 1000),
      end: String(NOW / 1000),
      step: "30",
    },
  ]);
  expect(body).toMatchObject({
    available: true,
    range: "1h",
    query: "container_memory_working_set_bytes",
    threshold: { op: ">", value: 536870912 },
    firing: { startsAt: NOW - HOUR },
  });
});

test("graph returns at most 10 series of at most 120 points", async () => {
  const t = newBackend();
  const itemId = await seedAlertItem(t, { generatorURL: graphUrl("up == 0") });
  stubPrometheus(() => rangeResult(12, 121));

  const { series } = await graph(t, itemId);

  expect(series?.length).toBe(10);
  expect(series?.map((line) => line.points.length)).toEqual(Array(10).fill(120));
});

test.each([
  ["no generator URL", {}],
  ["a generator URL without g0.expr", { generatorURL: "http://prometheus.example/alerts" }],
])("graph is unavailable for an alert with %s", async (_, seed) => {
  const t = newBackend();
  const itemId = await seedAlertItem(t, seed);
  const calls = stubPrometheus(() => rangeResult(1, 1));

  const body = await graph(t, itemId);

  expect([body.available, body.reason, calls.length]).toEqual([false, expect.any(String), 0]);
});

test("graph is unavailable with a reason when Prometheus fails", async () => {
  const t = newBackend();
  const itemId = await seedAlertItem(t, { generatorURL: graphUrl("up == 0") });
  stubPrometheus(() => new Response("upstream down", { status: 503 }));

  const body = await graph(t, itemId);

  expect([body.available, body.reason]).toEqual([false, "Prometheus query failed with status 503"]);
});
