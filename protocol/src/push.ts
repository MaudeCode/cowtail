import { z } from "zod";

import {
  jsonObjectSchema,
  nonEmptyStringSchema,
} from "./shared.js";

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

export type PushSendRequest = z.infer<typeof pushSendRequestSchema>;
export type PushTestRequest = z.infer<typeof pushTestRequestSchema>;
export type PushResult = z.infer<typeof pushResultSchema>;
