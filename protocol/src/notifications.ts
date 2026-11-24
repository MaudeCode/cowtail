import { z } from "zod";

import { itemSourceSchema, itemUrgencySchema } from "./items.ts";
import { sourceInfoSchema } from "./sources.ts";
import { dateOnlyStringSchema, jsonObjectSchema, nonEmptyStringSchema } from "./shared.ts";

const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Quiet hours hold back `today` pushes; a window whose end comes before its start runs past
// midnight.
export const quietHoursSchema = z
  .object({
    start: clockTimeSchema,
    end: clockTimeSchema,
    timeZone: z.string().refine(isTimeZone, "Expected an IANA time zone"),
  })
  .refine((hours) => hours.start !== hours.end, "Quiet hours need a start and end that differ");

// Keyed by `source` or `source:kind`; the more specific key wins when an item is created.
export const urgencyOverridesSchema = z
  .record(itemSourceSchema, itemUrgencySchema)
  .refine((overrides) => Object.keys(overrides).length <= 100, "At most 100 overrides");

export const notificationPreferencesSchema = z.object({
  dailyRoundupEnabled: z.boolean(),
  quietHours: quietHoursSchema.nullable(),
  urgencyOverrides: urgencyOverridesSchema,
  requireAuthForApprovals: z.boolean(),
});

// The iOS notification category each item push carries; the app registers one per value.
export const itemNotificationCategories = ["ITEM_APPROVAL", "ITEM_QUESTION", "ITEM_ACK"] as const;
export const itemNotificationCategorySchema = z.enum(itemNotificationCategories);

// The custom data of a push for one item. The app opens the alert when there is one. Item
// pushes set `mutable-content`, and the Notification Service Extension shows `source`.
export const itemPushDataSchema = z.object({
  itemId: nonEmptyStringSchema,
  alertId: nonEmptyStringSchema.optional(),
  source: sourceInfoSchema,
});

// The custom data of a summary push for a batch of `today` items, from Cowtail; the app
// opens the inbox.
export const itemBatchPushDataSchema = z.object({
  type: z.literal("item_batch"),
  count: z.number().int().min(2),
  source: sourceInfoSchema,
});

export const notificationPreferencesResponseSchema = z.object({
  ok: z.literal(true),
  preferences: notificationPreferencesSchema,
});

// Fields left out keep their stored value; `quietHours: null` turns quiet hours off.
export const notificationPreferencesUpdateRequestSchema = notificationPreferencesSchema.partial();

export const dailyRoundupPushPayloadSchema = z.object({
  type: z.literal("daily_roundup"),
  roundupFrom: dateOnlyStringSchema,
  roundupTo: dateOnlyStringSchema,
  url: nonEmptyStringSchema,
});

export const roundupTestRequestSchema = z.object({
  userId: nonEmptyStringSchema,
  from: dateOnlyStringSchema.optional(),
  to: dateOnlyStringSchema.optional(),
});

export const roundupTestResultSchema = z.object({
  ok: z.boolean(),
  userId: nonEmptyStringSchema,
  roundupFrom: dateOnlyStringSchema,
  roundupTo: dateOnlyStringSchema,
  title: nonEmptyStringSchema,
  body: nonEmptyStringSchema,
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(jsonObjectSchema),
});

export type QuietHours = z.infer<typeof quietHoursSchema>;
export type UrgencyOverrides = z.infer<typeof urgencyOverridesSchema>;
export type ItemNotificationCategory = z.infer<typeof itemNotificationCategorySchema>;
export type ItemPushData = z.infer<typeof itemPushDataSchema>;
export type ItemBatchPushData = z.infer<typeof itemBatchPushDataSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>;
export type NotificationPreferencesUpdateRequest = z.infer<
  typeof notificationPreferencesUpdateRequestSchema
>;
export type DailyRoundupPushPayload = z.infer<typeof dailyRoundupPushPayloadSchema>;
export type RoundupTestRequest = z.infer<typeof roundupTestRequestSchema>;
export type RoundupTestResult = z.infer<typeof roundupTestResultSchema>;
