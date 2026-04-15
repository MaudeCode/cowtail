import { z } from "zod";

import { jsonObjectSchema, nonEmptyStringSchema } from "./shared.js";

export const pushRegisterRequestSchema = z.object({
  identityToken: nonEmptyStringSchema,
  deviceToken: nonEmptyStringSchema,
  platform: nonEmptyStringSchema.optional(),
  environment: nonEmptyStringSchema.optional(),
  deviceName: nonEmptyStringSchema.optional(),
});

export const pushRegisterResponseSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  id: nonEmptyStringSchema,
});

export const pushUnregisterRequestSchema = z.object({
  deviceToken: nonEmptyStringSchema,
});

export const pushUnregisterResponseSchema = z.object({
  ok: z.literal(true),
  updated: z.boolean(),
});

export const pushSendRequestSchema = z.object({
  userId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  body: nonEmptyStringSchema,
  data: jsonObjectSchema.optional(),
});

export const pushTestRequestSchema = z.object({
  userId: nonEmptyStringSchema,
  title: nonEmptyStringSchema.optional(),
  body: nonEmptyStringSchema.optional(),
  data: jsonObjectSchema.optional(),
});

export const pushResultSchema = z.object({
  ok: z.boolean(),
  userId: nonEmptyStringSchema,
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(jsonObjectSchema),
});
export type PushRegisterRequest = z.infer<typeof pushRegisterRequestSchema>;
export type PushRegisterResponse = z.infer<typeof pushRegisterResponseSchema>;
export type PushUnregisterRequest = z.infer<typeof pushUnregisterRequestSchema>;
export type PushUnregisterResponse = z.infer<typeof pushUnregisterResponseSchema>;
export type PushSendRequest = z.infer<typeof pushSendRequestSchema>;
export type PushTestRequest = z.infer<typeof pushTestRequestSchema>;
export type PushResult = z.infer<typeof pushResultSchema>;
