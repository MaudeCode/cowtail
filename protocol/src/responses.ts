import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.js";

export const okResponseSchema = z.object({
  ok: z.literal(true),
});

export const createResponseSchema = z.object({
  ok: z.literal(true),
  id: nonEmptyStringSchema,
});

export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: nonEmptyStringSchema,
});

export type OkResponse = z.infer<typeof okResponseSchema>;
export type CreateResponse = z.infer<typeof createResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
