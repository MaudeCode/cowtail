import { z } from "zod";

import {
  alertOutcomes,
  alertStatuses,
  nonEmptyStringSchema,
  timestampSchema,
} from "./shared.js";

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

export type AlertCreateRequest = z.infer<typeof alertCreateRequestSchema>;
export type AlertOutcome = z.infer<typeof alertOutcomeSchema>;
export type AlertStatus = z.infer<typeof alertStatusSchema>;
