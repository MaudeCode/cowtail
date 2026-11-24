import { describe, expect, test } from "vitest";

import { maintenanceWindowStartRequestSchema } from "./maintenance.ts";

const request = { title: "Cluster upgrade", durationMs: 60 * 60_000 };

describe("maintenance window start requests", () => {
  test("take a minute to 7 days", () => {
    const lasting = (durationMs: number) =>
      maintenanceWindowStartRequestSchema.safeParse({ ...request, durationMs }).success;
    expect([59_999, 60_000, 7 * 86_400_000, 7 * 86_400_000 + 1].map(lasting)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  test("refuse a matcher label Alertmanager cannot hold, and take * as every source", () => {
    const parse = (body: Record<string, unknown>) =>
      maintenanceWindowStartRequestSchema.safeParse({ ...request, ...body }).success;
    expect(parse({ matchers: [{ label: "k8s.namespace", value: "media" }] })).toBe(false);
    expect(parse({ matchers: [{ label: "namespace", value: "media" }], sources: ["*"] })).toBe(
      true,
    );
  });
});
