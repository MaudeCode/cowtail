import { describe, expect, test } from "bun:test";

import {
  buildDailyRoundupBody,
  buildRoundupCounts,
  buildDailyRoundupPayload,
  resolveRoundupWindow,
  resolvePreviousRoundupWindow,
  shouldRunDailyRoundupAt,
} from "./roundup";

describe("roundup helpers", () => {
  test("resolvePreviousRoundupWindow uses the previous local calendar day", () => {
    const window = resolvePreviousRoundupWindow(
      new Date("2026-04-15T12:00:00.000Z"),
      "America/New_York",
    );

    expect(window.roundupFrom).toBe("2026-04-14");
    expect(window.roundupTo).toBe("2026-04-14");
    expect(window.roundupKey).toBe("2026-04-14:2026-04-14");
  });

  test("resolveRoundupWindow returns a stable roundup key", () => {
    const window = resolveRoundupWindow("2026-04-10", "2026-04-12", "America/New_York");

    expect(window.roundupKey).toBe("2026-04-10:2026-04-12");
    expect(window.fromTimestamp).toBeLessThan(window.toTimestamp);
  });

  test("shouldRunDailyRoundupAt only matches the configured local hour at minute zero", () => {
    expect(
      shouldRunDailyRoundupAt(new Date("2026-04-15T12:00:00.000Z"), "America/New_York", 8),
    ).toBe(true);
    expect(
      shouldRunDailyRoundupAt(new Date("2026-04-15T12:30:00.000Z"), "America/New_York", 8),
    ).toBe(false);
    expect(
      shouldRunDailyRoundupAt(new Date("2026-04-15T13:00:00.000Z"), "America/New_York", 8),
    ).toBe(false);
  });

  test("buildRoundupCounts summarizes alerts and fixes", () => {
    const counts = buildRoundupCounts(
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

  test("buildDailyRoundupBody renders quiet-day copy", () => {
    const body = buildDailyRoundupBody(
      resolveRoundupWindow("2026-04-14", "2026-04-14", "America/New_York"),
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

  test("buildDailyRoundupBody renders populated roundup copy", () => {
    const body = buildDailyRoundupBody(
      resolveRoundupWindow("2026-04-14", "2026-04-14", "America/New_York"),
      {
        total: 12,
        fixed: 5,
        selfResolved: 3,
        noise: 2,
        escalated: 2,
        fixes: 3,
      },
    );

    expect(body).toBe("Apr 14: 12 alerts, 5 fixed, 3 self-resolved, 2 escalated, 3 fixes shipped.");
  });

  test("buildDailyRoundupPayload uses the roundup URL", () => {
    const payload = buildDailyRoundupPayload(
      resolveRoundupWindow("2026-04-14", "2026-04-14", "America/New_York"),
      "https://cowtail.example.com/",
    );

    expect(payload.url).toBe("https://cowtail.example.com/roundup?from=2026-04-14&to=2026-04-14");
  });
});
