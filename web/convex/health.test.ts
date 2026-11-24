import { healthResponseSchema } from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { newBackend, request, stubEnv } from "../test/convexHarness";

const PROMETHEUS = "https://prometheus.test";

beforeEach(() => {
  stubEnv({ PROMETHEUS_BASE_URL: PROMETHEUS });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Prometheus answers each query by its metric name; anything else is empty.
function stubPrometheus(results: Record<string, unknown[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      const parsed = new URL(String(url));
      if (`${parsed.origin}${parsed.pathname}` !== `${PROMETHEUS}/api/v1/query`) {
        throw new Error(`unexpected fetch ${url}`);
      }
      const query = parsed.searchParams.get("query") ?? "";
      const key = Object.keys(results).find((metric) => query.includes(metric));
      return Response.json({ status: "success", data: { result: key ? results[key] : [] } });
    }),
  );
}

test("health counts the nodes that report Ready", async () => {
  const sample = (metric: Record<string, string>, value: string) => ({ metric, value: [0, value] });
  stubPrometheus({
    node_cpu_seconds_total: ["node-1", "node-2", "node-3"].map((nodename) =>
      sample({ nodename }, "10"),
    ),
    kube_node_status_condition: [sample({ node: "node-1" }, "1"), sample({ node: "node-3" }, "1")],
  });

  const response = await request(newBackend(), "/api/health");
  const health = healthResponseSchema.parse(response.json);

  expect([health.nodes.map((node) => node.status), health.readyNodes]).toEqual([
    ["Ready", "NotReady", "Ready"],
    2,
  ]);
});
