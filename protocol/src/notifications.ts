import { z } from "zod";

import { itemSourceSchema, itemUrgencySchema } from "./items.ts";
import { sourceInfoSchema } from "./sources.ts";
import {
  dateOnlyStringSchema,
  jsonObjectSchema,
  nonEmptyStringSchema,
  timeZoneSchema,
} from "./shared.ts";

const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

// Quiet hours hold back `today` pushes; a window whose end comes before its start runs past
// midnight.
export const quietHoursSchema = z
  .object({
    start: clockTimeSchema,
    end: clockTimeSchema,
    timeZone: timeZoneSchema,
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
// An approval goes as ITEM_APPROVAL_AUTH while the owner requires Face ID for approvals, so
// every device asks for it on the lock screen whatever settings it last loaded.
export const itemNotificationCategories = [
  "ITEM_APPROVAL",
  "ITEM_APPROVAL_AUTH",
  "ITEM_QUESTION",
  "ITEM_ACK",
] as const;
export const itemNotificationCategorySchema = z.enum(itemNotificationCategories);

// The custom data of a push for one item. The app opens the alert when there is one. Item
// pushes set `mutable-content`, and the Notification Service Extension shows `source`.
export const itemPushDataSchema = z.object({
  itemId: nonEmptyStringSchema,
  alertId: nonEmptyStringSchema.optional(),
  source: sourceInfoSchema,
});

// The custom data of a summary push for a batch of `today` items, from Cowtail; the app
// opens the inbox. `itemIds` lists the batch, so the app removes the push once none of them
// is live; it is absent when the list would not fit in the push, and the push then stays.
export const itemBatchPushDataSchema = z.object({
  type: z.literal("item_batch"),
  count: z.number().int().min(2),
  itemIds: z.array(nonEmptyStringSchema).min(2).optional(),
  source: sourceInfoSchema,
});

// The custom data of a background push (`content-available`, no alert) sent a few seconds
// after items stop being live: the app sets `badge` and removes those items' delivered
// notifications. iOS throttles background pushes, so the inbox's `badge` and `liveItemIds`
// stay the guarantee and this push is only the fast path.
export const itemSyncPushDataSchema = z.object({
  type: z.literal("item_sync"),
  badge: z.number().int().nonnegative(),
  itemIds: z.array(nonEmptyStringSchema).min(1),
});

export const notificationPreferencesResponseSchema = z.object({
  ok: z.literal(true),
  preferences: notificationPreferencesSchema,
  // The urgency override keys in the order to show them. Optional so a client still decodes
  // a server from before it.
  urgencyOverrideOrder: z.array(itemSourceSchema).optional(),
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
export type ItemSyncPushData = z.infer<typeof itemSyncPushDataSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>;
export type NotificationPreferencesUpdateRequest = z.infer<
  typeof notificationPreferencesUpdateRequestSchema
>;
export type DailyRoundupPushPayload = z.infer<typeof dailyRoundupPushPayloadSchema>;
export type RoundupTestRequest = z.infer<typeof roundupTestRequestSchema>;
export type RoundupTestResult = z.infer<typeof roundupTestResultSchema>;
