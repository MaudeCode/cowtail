import { z } from "zod";

import { okResponseSchema } from "./responses.ts";
import { nonEmptyStringSchema, timestampSchema } from "./shared.ts";

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

// Sign-in methods the server accepts. `oidc` is present only when OIDC is fully configured.
export const authProvidersResponseSchema = z.object({
  apple: z.literal(true),
  oidc: z.object({ name: nonEmptyStringSchema }).optional(),
});

// RFC 7636 code verifier: the app's secret for the S256 challenge it sent to the OIDC start route.
export const pkceCodeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, {
  message: "verifier must be an RFC 7636 code verifier",
});

export const authOidcHandoffRequestSchema = z.object({
  code: nonEmptyStringSchema,
  verifier: pkceCodeVerifierSchema,
});

export const authOidcHandoffResponseSchema = authSessionCreateResponseSchema;

export const authLogoutResponseSchema = okResponseSchema;

export type AuthSessionCreateRequest = z.infer<typeof authSessionCreateRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthSessionCreateResponse = z.infer<typeof authSessionCreateResponseSchema>;
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>;
export type AuthOidcHandoffRequest = z.infer<typeof authOidcHandoffRequestSchema>;
export type AuthOidcHandoffResponse = z.infer<typeof authOidcHandoffResponseSchema>;
export type AuthLogoutResponse = z.infer<typeof authLogoutResponseSchema>;
