import { z } from "zod";

import { nonEmptyStringSchema, timestampSchema } from "./shared.ts";

// --- Catalog -----------------------------------------------------------------------------
// The MaudeUtils scripts on the Hermes host, as the Hermes plugin reports them in each
// heartbeat. MaudeUtils stays unexposed: Hermes runs every script Cowtail asks for.

export const runbookScriptSchema = z.object({
  id: nonEmptyStringSchema.max(200),
  name: nonEmptyStringSchema.max(200),
  description: z.string().max(2_000).optional(),
  category: nonEmptyStringSchema.max(100),
  icon: z.string().max(50).optional(),
  // The prompt MaudeUtils shows before it runs the script.
  confirm: z.string().max(2_000).optional(),
  danger: z.boolean().optional(),
});

// A catalog script with Cowtail's calls on it. `confirmText` is present when the script asks
// to confirm (it has `confirm` or `danger`); `needsAuth` when running it also needs Face ID,
// because the owner requires Face ID for approvals; `running` while a run of it is queued or
// running.
export const runbookStatusScriptSchema = runbookScriptSchema.extend({
  confirmText: z.string().optional(),
  needsAuth: z.boolean(),
  running: z.boolean(),
});

// One section per category, in the catalog's order, each with its scripts in that order.
export const runbookSectionSchema = z.object({
  category: nonEmptyStringSchema,
  scripts: z.array(runbookStatusScriptSchema),
});

// --- Runs --------------------------------------------------------------------------------

// `unknown`: Hermes stopped reporting after the script started, so it may or may not have run.
// Cowtail never runs it again on its own.
export const runbookRunStatuses = ["queued", "running", "succeeded", "failed", "unknown"] as const;
export const runbookRunStatusSchema = z.enum(runbookRunStatuses);

export const runbookRunRecordSchema = z.object({
  id: nonEmptyStringSchema,
  scriptId: nonEmptyStringSchema,
  scriptName: nonEmptyStringSchema,
  itemId: nonEmptyStringSchema.optional(),
  status: runbookRunStatusSchema,
  // Queued and running runs only.
  active: z.boolean(),
  exitCode: z.number().int().optional(),
  createdAt: timestampSchema,
  // When Hermes first picked the run up.
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional(),
});

// The owner asks Hermes to run a script, optionally for an item, whose timeline then records
// the run's start and finish. A script that asks to confirm needs `confirmed: true`, and while
// the owner requires Face ID for approvals, `authenticated: true` as well.
export const runbookRunRequestSchema = z.object({
  scriptId: nonEmptyStringSchema.max(200),
  itemId: nonEmptyStringSchema.optional(),
  confirmed: z.boolean().optional(),
  authenticated: z.boolean().optional(),
});

export const runbookRunResponseSchema = z.object({
  ok: z.literal(true),
  run: runbookRunRecordSchema,
});

// A run and its output so far: stdout and stderr as they arrived, at most 256 KB, then a
// truncation marker.
export const runbookRunGetResponseSchema = z.object({
  ok: z.literal(true),
  run: runbookRunRecordSchema,
  output: z.string(),
});

// --- Hermes worker -----------------------------------------------------------------------

export const runbookOutputLimitBytes = 256 * 1024;
export const runbookOutputBatchLimit = 64 * 1024;

export const runbookRunClaimRequestSchema = z.object({
  workerId: nonEmptyStringSchema.max(200).optional(),
  leaseSeconds: z.number().int().min(5).max(3_600).optional(),
});

export const runbookRunClaimResponseSchema = z.object({
  ok: z.literal(true),
  run: z
    .object({
      id: nonEmptyStringSchema,
      scriptId: nonEmptyStringSchema,
      claimToken: nonEmptyStringSchema,
      leaseUntil: timestampSchema,
      attempts: z.number().int().positive(),
    })
    .optional(),
});

// One batch of output. `seq` counts the claim's batches from 0, so a batch sent again is
// stored once; each batch also renews the claim's lease. An empty batch only renews it. Hermes
// sends batch 0 before it asks MaudeUtils to run the script: a claim whose lease runs out before
// any batch is leased again, and one that sent a batch ends `unknown` instead.
export const runbookRunOutputRequestSchema = z.object({
  claimToken: nonEmptyStringSchema,
  seq: z.number().int().nonnegative(),
  text: z.string().max(runbookOutputBatchLimit),
});

// The script's exit code; a run MaudeUtils refused or lost reports -1.
export const runbookRunCompleteRequestSchema = z.object({
  claimToken: nonEmptyStringSchema,
  exitCode: z.number().int(),
});

export type RunbookScript = z.infer<typeof runbookScriptSchema>;
export type RunbookStatusScript = z.infer<typeof runbookStatusScriptSchema>;
export type RunbookSection = z.infer<typeof runbookSectionSchema>;
export type RunbookRunStatus = z.infer<typeof runbookRunStatusSchema>;
export type RunbookRunRecord = z.infer<typeof runbookRunRecordSchema>;
export type RunbookRunRequest = z.infer<typeof runbookRunRequestSchema>;
export type RunbookRunResponse = z.infer<typeof runbookRunResponseSchema>;
export type RunbookRunGetResponse = z.infer<typeof runbookRunGetResponseSchema>;
export type RunbookRunClaimRequest = z.infer<typeof runbookRunClaimRequestSchema>;
export type RunbookRunClaimResponse = z.infer<typeof runbookRunClaimResponseSchema>;
export type RunbookRunOutputRequest = z.infer<typeof runbookRunOutputRequestSchema>;
export type RunbookRunCompleteRequest = z.infer<typeof runbookRunCompleteRequestSchema>;
