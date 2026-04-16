import { z } from "zod";

import { dateOnlyStringSchema, jsonObjectSchema, nonEmptyStringSchema } from "./shared.js";

export const notificationPreferencesSchema = z.object({
  dailyDigestEnabled: z.boolean(),
});

export const notificationPreferencesResponseSchema = z.object({
  ok: z.literal(true),
  preferences: notificationPreferencesSchema,
});

export const notificationPreferencesUpdateRequestSchema = notificationPreferencesSchema;

export const dailyDigestPushPayloadSchema = z.object({
  type: z.literal("daily_digest"),
  digestFrom: dateOnlyStringSchema,
  digestTo: dateOnlyStringSchema,
  url: nonEmptyStringSchema,
});

export const digestTestRequestSchema = z.object({
  userId: nonEmptyStringSchema,
  from: dateOnlyStringSchema.optional(),
  to: dateOnlyStringSchema.optional(),
});

export const digestTestResultSchema = z.object({
  ok: z.boolean(),
  userId: nonEmptyStringSchema,
  digestFrom: dateOnlyStringSchema,
  digestTo: dateOnlyStringSchema,
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
export type DailyDigestPushPayload = z.infer<typeof dailyDigestPushPayloadSchema>;
export type DigestTestRequest = z.infer<typeof digestTestRequestSchema>;
export type DigestTestResult = z.infer<typeof digestTestResultSchema>;
