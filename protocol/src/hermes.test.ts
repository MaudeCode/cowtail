import { describe, expect, test } from "vitest";

import { hermesSnapshotSchema } from "./hermes.ts";

const snapshot = { platforms: ["cowtail"], cronJobs: [], openIncidents: [] };

describe("Hermes heartbeat snapshots", () => {
  test("refuse budget and rate-limit keys the status store cannot hold", () => {
    for (const key of ["_id", "$set", ""]) {
      expect(hermesSnapshotSchema.safeParse({ ...snapshot, budget: { [key]: 1 } }).success).toBe(
        false,
      );
      expect(
        hermesSnapshotSchema.safeParse({ ...snapshot, rateLimits: { [key]: 1 } }).success,
      ).toBe(false);
    }
    expect(
      hermesSnapshotSchema.parse({
        ...snapshot,
        budget: { "daily.usd": 4.2 },
        rateLimits: { anthropic: "ok" },
      }),
    ).toMatchObject({ budget: { "daily.usd": 4.2 }, rateLimits: { anthropic: "ok" } });
  });
});
