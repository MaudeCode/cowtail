import { z } from "zod";

import { alertOutcomes, alertStatuses, nonEmptyStringSchema, timestampSchema } from "./shared.js";

export const alertOutcomeSchema = z.enum(alertOutcomes);
export const alertStatusSchema = z.enum(alertStatuses);

export const alertCreateRequestSchema = z.object({
  timestamp: timestampSchema.optional(),
  alertname: nonEmptyStringSchema,
  severity: nonEmptyStringSchema,
  namespace: nonEmptyStringSchema,
  node: nonEmptyStringSchema.optional(),
  status: alertStatusSchema,
  outcome: alertOutcomeSchema,
  summary: nonEmptyStringSchema,
  action: nonEmptyStringSchema,
  rootCause: nonEmptyStringSchema.optional(),
  messaged: z.boolean().optional(),
  resolvedAt: timestampSchema.optional(),
});

export const alertRecordSchema = z.object({
  id: nonEmptyStringSchema,
  timestamp: timestampSchema,
  alertname: nonEmptyStringSchema,
  severity: nonEmptyStringSchema,
  namespace: nonEmptyStringSchema,
  node: nonEmptyStringSchema.optional(),
  status: alertStatusSchema,
  outcome: alertOutcomeSchema,
  summary: nonEmptyStringSchema,
  action: nonEmptyStringSchema,
  rootCause: nonEmptyStringSchema.optional(),
  messaged: z.boolean(),
  resolvedAt: timestampSchema.optional(),
});

export const alertListQuerySchema = z.object({
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  alertname: nonEmptyStringSchema.optional(),
  severity: nonEmptyStringSchema.optional(),
  namespace: nonEmptyStringSchema.optional(),
  status: alertStatusSchema.optional(),
  outcome: alertOutcomeSchema.optional(),
});

export const alertListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  alerts: z.array(alertRecordSchema),
});

export const alertGetResponseSchema = z.object({
  ok: z.literal(true),
  alert: alertRecordSchema,
});

export type AlertCreateRequest = z.infer<typeof alertCreateRequestSchema>;
export type AlertRecord = z.infer<typeof alertRecordSchema>;
export type AlertListQuery = z.infer<typeof alertListQuerySchema>;
export type AlertListResponse = z.infer<typeof alertListResponseSchema>;
export type AlertGetResponse = z.infer<typeof alertGetResponseSchema>;
export type AlertOutcome = z.infer<typeof alertOutcomeSchema>;
export type AlertStatus = z.infer<typeof alertStatusSchema>;
