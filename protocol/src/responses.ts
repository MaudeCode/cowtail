import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.js";

export const createResponseSchema = z.object({
  ok: z.literal(true),
  id: nonEmptyStringSchema,
});

export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: nonEmptyStringSchema,
});

export type CreateResponse = z.infer<typeof createResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
