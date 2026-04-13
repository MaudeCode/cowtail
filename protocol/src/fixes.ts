import { z } from "zod";

import {
  fixScopes,
  nonEmptyStringSchema,
  timestampSchema,
} from "./shared.js";

export const fixScopeSchema = z.enum(fixScopes);

export const fixCreateRequestSchema = z.object({
  timestamp: timestampSchema.optional(),
  alertIds: z.array(nonEmptyStringSchema).min(1),
  description: nonEmptyStringSchema,
  rootCause: nonEmptyStringSchema,
  scope: fixScopeSchema,
  commit: nonEmptyStringSchema.optional(),
});

export type FixCreateRequest = z.infer<typeof fixCreateRequestSchema>;
export type FixScope = z.infer<typeof fixScopeSchema>;
