import { z } from "zod";

import { dateOnlyStringSchema, jsonObjectSchema, nonEmptyStringSchema } from "./shared.js";

export const notificationPreferencesSchema = z.object({
  dailyRoundupEnabled: z.boolean(),
});

export const notificationPreferencesResponseSchema = z.object({
  ok: z.literal(true),
  preferences: notificationPreferencesSchema,
});

export const notificationPreferencesUpdateRequestSchema = notificationPreferencesSchema;

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

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>;
export type NotificationPreferencesUpdateRequest = z.infer<
  typeof notificationPreferencesUpdateRequestSchema
>;
export type DailyRoundupPushPayload = z.infer<typeof dailyRoundupPushPayloadSchema>;
export type RoundupTestRequest = z.infer<typeof roundupTestRequestSchema>;
export type RoundupTestResult = z.infer<typeof roundupTestResultSchema>;
