import { describe, expect, test } from "vitest";

import { formatReturnTime } from "./format";
import { snoozePresets } from "./snooze";

// Local-time dates, so the tests hold in any time zone.
describe("snooze presets", () => {
  test("from Monday 09:41 they return at the figure's times", () => {
    const monday = new Date(2026, 10, 23, 9, 41);

    expect(
      snoozePresets(monday).map(({ label, until }) => [
        label,
        formatReturnTime(until, monday.getTime()),
      ]),
    ).toEqual([
      ["1 hour", "Today 10:41"],
      ["4 hours", "Today 13:41"],
      ["Tomorrow", "Tue 09:00"],
      ["Next Monday", "30 Nov 09:00"],
    ]);
  });

  test("from a Sunday, next Monday is tomorrow", () => {
    const sunday = new Date(2026, 10, 29, 20, 0);
    const [, , tomorrow, nextMonday] = snoozePresets(sunday);

    expect(nextMonday.until).toBe(tomorrow.until);
    expect(new Date(nextMonday.until)).toEqual(new Date(2026, 10, 30, 9, 0));
  });
});
