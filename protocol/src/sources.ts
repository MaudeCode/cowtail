import { z } from "zod";

import { timestampSchema } from "./shared.ts";

// A source is a registered producer of items: Alertmanager, Hermes, the Mac deployer.
export const sourceSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, "Expected 2 to 32 lowercase letters, digits or -");
export const sourceDisplayNameSchema = z.string().trim().min(1).max(40);

// How an item or a push names its source: what the apps show beside it. `iconUrl` is
// absent while the source has no icon.
export const sourceInfoSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  iconUrl: z.url().optional(),
});

// A source as the admin API lists it. Its token is never returned after it is issued.
export const sourceRecordSchema = sourceInfoSchema.extend({
  slug: sourceSlugSchema,
  enabled: z.boolean(),
  hasToken: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const sourceCreateRequestSchema = z.object({
  slug: sourceSlugSchema,
  displayName: sourceDisplayNameSchema,
});

export const sourcePatchRequestSchema = z
  .object({
    displayName: sourceDisplayNameSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (patch) => patch.displayName !== undefined || patch.enabled !== undefined,
    "Expected displayName or enabled",
  );

// Creating a source and rotating its token both return the token, once.
export const sourceTokenResponseSchema = z.object({
  ok: z.literal(true),
  source: sourceRecordSchema,
  token: z.string().startsWith("cts_"),
});

export const sourceResponseSchema = z.object({
  ok: z.literal(true),
  source: sourceRecordSchema,
});

export const sourceListResponseSchema = z.object({
  ok: z.literal(true),
  sources: z.array(sourceRecordSchema),
});

export type SourceInfo = z.infer<typeof sourceInfoSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type SourceCreateRequest = z.infer<typeof sourceCreateRequestSchema>;
export type SourcePatchRequest = z.infer<typeof sourcePatchRequestSchema>;
export type SourceTokenResponse = z.infer<typeof sourceTokenResponseSchema>;
export type SourceResponse = z.infer<typeof sourceResponseSchema>;
export type SourceListResponse = z.infer<typeof sourceListResponseSchema>;
