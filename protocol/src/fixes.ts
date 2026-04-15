import { z } from "zod";

import { fixScopes, nonEmptyStringSchema, timestampSchema } from "./shared.js";

export const fixScopeSchema = z.enum(fixScopes);

export const fixCreateRequestSchema = z.object({
  timestamp: timestampSchema.optional(),
  alertIds: z.array(nonEmptyStringSchema).min(1),
  description: nonEmptyStringSchema,
  rootCause: nonEmptyStringSchema,
  scope: fixScopeSchema,
  commit: nonEmptyStringSchema.optional(),
});

export const fixRecordSchema = z.object({
  id: nonEmptyStringSchema,
  timestamp: timestampSchema,
  alertIds: z.array(nonEmptyStringSchema).min(1),
  description: nonEmptyStringSchema,
  rootCause: nonEmptyStringSchema,
  scope: fixScopeSchema,
  commit: nonEmptyStringSchema.optional(),
});

export const fixListQuerySchema = z.object({
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  scope: fixScopeSchema.optional(),
  alertId: nonEmptyStringSchema.optional(),
});

export const fixListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  fixes: z.array(fixRecordSchema),
});

export const fixGetResponseSchema = z.object({
  ok: z.literal(true),
  fix: fixRecordSchema,
});

export type FixCreateRequest = z.infer<typeof fixCreateRequestSchema>;
export type FixRecord = z.infer<typeof fixRecordSchema>;
export type FixListQuery = z.infer<typeof fixListQuerySchema>;
export type FixListResponse = z.infer<typeof fixListResponseSchema>;
export type FixGetResponse = z.infer<typeof fixGetResponseSchema>;
export type FixScope = z.infer<typeof fixScopeSchema>;
