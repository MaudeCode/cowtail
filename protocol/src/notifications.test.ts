import { describe, expect, test } from "vitest";

import {
  notificationPreferencesResponseSchema,
  notificationPreferencesUpdateRequestSchema,
} from "./notifications.ts";

const preferences = {
  dailyRoundupEnabled: true,
  quietHours: { start: "22:00", end: "07:00", timeZone: "America/New_York" },
  urgencyOverrides: { hermes: "now", "cron:fyi": "whenever" },
  requireAuthForApprovals: true,
};

describe("notification preferences", () => {
  test("carry quiet hours, urgency overrides and the approval auth setting", () => {
    expect(notificationPreferencesResponseSchema.parse({ ok: true, preferences })).toEqual({
      ok: true,
      preferences,
    });
    expect(
      notificationPreferencesResponseSchema.parse({
        ok: true,
        preferences: { ...preferences, quietHours: null, urgencyOverrides: {} },
      }).preferences.quietHours,
    ).toBeNull();
  });

  test("an update names only the fields it changes", () => {
    expect(
      notificationPreferencesUpdateRequestSchema.parse({ dailyRoundupEnabled: false }),
    ).toEqual({ dailyRoundupEnabled: false });
    expect(notificationPreferencesUpdateRequestSchema.parse({ quietHours: null })).toEqual({
      quietHours: null,
    });
  });

  test("refuse quiet hours the server cannot place in time", () => {
    const quietHours = (value: Record<string, string>) =>
      notificationPreferencesUpdateRequestSchema.safeParse({
        quietHours: { ...preferences.quietHours, ...value },
      }).success;
    expect(quietHours({})).toBe(true);
    expect(quietHours({ start: "24:00" })).toBe(false);
    expect(quietHours({ end: "7:00" })).toBe(false);
    expect(quietHours({ timeZone: "Mars/Olympus_Mons" })).toBe(false);
    expect(quietHours({ end: "22:00" })).toBe(false);
  });

  test("refuse overrides keyed by anything but a source or source:kind, or naming no urgency", () => {
    const overrides = (value: Record<string, string>) =>
      notificationPreferencesUpdateRequestSchema.safeParse({ urgencyOverrides: value }).success;
    expect(overrides({ hermes: "now", "cron:fyi": "whenever" })).toBe(true);
    expect(overrides({ Hermes: "now" })).toBe(false);
    expect(overrides({ hermes: "urgent" })).toBe(false);
  });
});
