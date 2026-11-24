import { expect, test } from "vitest";

import { healthResponseSchema } from "./health.ts";

const cluster = {
  version: 1,
  nodes: [{ name: "node-1", status: "Ready", cpu: 12, memory: 40 }],
  cephStatus: "HEALTH_OK",
  cephMessage: "All PGs active+clean",
  storageUsed: 1.5,
  storageTotal: 10,
  storageUnit: "TiB",
};

test("health carries the alert pipeline state and still decodes a server without it", () => {
  const silent = { state: "silent", lastWatchdogAt: 1795521600000 };
  expect(healthResponseSchema.parse({ ...cluster, alertPipeline: silent }).alertPipeline).toEqual(
    silent,
  );
  expect(
    healthResponseSchema.parse({ ...cluster, alertPipeline: { state: "not_configured" } })
      .alertPipeline,
  ).toEqual({ state: "not_configured" });
  expect(healthResponseSchema.parse(cluster).alertPipeline).toBeUndefined();
  expect(
    healthResponseSchema.safeParse({ ...cluster, alertPipeline: { state: "unknown" } }).success,
  ).toBe(false);
});
