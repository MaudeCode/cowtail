import { expect, test } from "vitest";

import { formatReturnTime } from "./format";

// Local-time dates, so the test holds in any time zone.
test("a return time reads Today, a weekday within six days, otherwise a date", () => {
  const monday = new Date(2026, 10, 23, 9, 41).getTime();

  expect(
    [
      new Date(2026, 10, 23, 13, 41),
      new Date(2026, 10, 24, 9, 0),
      new Date(2026, 10, 29, 9, 0),
      new Date(2026, 10, 30, 9, 0),
    ].map((at) => formatReturnTime(at.getTime(), monday)),
  ).toEqual(["Today 13:41", "Tue 09:00", "Sun 09:00", "30 Nov 09:00"]);
});
