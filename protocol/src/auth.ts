import { z } from "zod";

import { nonEmptyStringSchema, timestampSchema } from "./shared.js";

export const authSessionCreateRequestSchema = z.object({
  identityToken: nonEmptyStringSchema,
});

export const authSessionSchema = z.object({
  token: nonEmptyStringSchema,
  userId: nonEmptyStringSchema,
  expiresAt: timestampSchema,
});

export const authSessionCreateResponseSchema = z.object({
  ok: z.literal(true),
  session: authSessionSchema,
});

export type AuthSessionCreateRequest = z.infer<typeof authSessionCreateRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthSessionCreateResponse = z.infer<typeof authSessionCreateResponseSchema>;
