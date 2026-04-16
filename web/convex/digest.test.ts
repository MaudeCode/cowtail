import { describe, expect, test } from "bun:test";

import {
  buildDailyDigestBody,
  buildDigestCounts,
  resolveDigestWindow,
  resolvePreviousDigestWindow,
  shouldRunDailyDigestAt,
} from "./digest";

describe("digest helpers", () => {
  test("resolvePreviousDigestWindow uses the previous local calendar day", () => {
    const window = resolvePreviousDigestWindow(
      new Date("2026-04-15T12:00:00.000Z"),
      "America/New_York",
    );

    expect(window.digestFrom).toBe("2026-04-14");
    expect(window.digestTo).toBe("2026-04-14");
    expect(window.digestKey).toBe("2026-04-14:2026-04-14");
  });

  test("resolveDigestWindow returns a stable digest key", () => {
    const window = resolveDigestWindow("2026-04-10", "2026-04-12", "America/New_York");

    expect(window.digestKey).toBe("2026-04-10:2026-04-12");
    expect(window.fromTimestamp).toBeLessThan(window.toTimestamp);
  });

  test("shouldRunDailyDigestAt only matches the configured local hour at minute zero", () => {
    expect(
      shouldRunDailyDigestAt(new Date("2026-04-15T12:00:00.000Z"), "America/New_York", 8),
    ).toBe(true);
    expect(
      shouldRunDailyDigestAt(new Date("2026-04-15T12:30:00.000Z"), "America/New_York", 8),
    ).toBe(false);
    expect(
      shouldRunDailyDigestAt(new Date("2026-04-15T13:00:00.000Z"), "America/New_York", 8),
    ).toBe(false);
  });

  test("buildDigestCounts summarizes alerts and fixes", () => {
    const counts = buildDigestCounts(
      [
        { outcome: "fixed" },
        { outcome: "self-resolved" },
        { outcome: "escalated" },
        { outcome: "fixed" },
      ],
      [{}, {}],
    );

    expect(counts).toEqual({
      total: 4,
      fixed: 2,
      selfResolved: 1,
      noise: 0,
      escalated: 1,
      fixes: 2,
    });
  });

  test("buildDailyDigestBody renders quiet-day copy", () => {
    const body = buildDailyDigestBody(
      resolveDigestWindow("2026-04-14", "2026-04-14", "America/New_York"),
      {
        total: 0,
        fixed: 0,
        selfResolved: 0,
        noise: 0,
        escalated: 0,
        fixes: 0,
      },
    );

    expect(body).toBe("Apr 14: No alerts fired. Quiet day.");
  });

  test("buildDailyDigestBody renders populated digest copy", () => {
    const body = buildDailyDigestBody(
      resolveDigestWindow("2026-04-14", "2026-04-14", "America/New_York"),
      {
        total: 12,
        fixed: 5,
        selfResolved: 3,
        noise: 2,
        escalated: 2,
        fixes: 3,
      },
    );

    expect(body).toBe(
      "Apr 14: 12 alerts, 5 fixed, 3 self-resolved, 2 escalated, 3 fixes shipped.",
    );
  });
});
