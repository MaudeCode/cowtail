import { z } from "zod";

import { fieldNameSchema, itemAnswerSchema, itemReplyToSchema } from "./items.ts";
import { nonEmptyStringSchema, timestampSchema } from "./shared.ts";

// --- Answers flowing back to Hermes ------------------------------------------------------
// The owner's answer to an item with a `replyTo` waits here until Hermes claims it. The Hermes
// platform sets `replyTo` to {type: "approval", sessionKey}, {type: "clarify", clarifyId} or
// {type: "cron_incident", incidentId}; Cowtail returns it untouched.

export const hermesResponseClaimRequestSchema = z.object({
  workerId: nonEmptyStringSchema.max(200).optional(),
  leaseSeconds: z.number().int().min(5).max(3_600).optional(),
});

export const hermesResponseRecordSchema = z.object({
  id: nonEmptyStringSchema,
  itemId: nonEmptyStringSchema,
  replyTo: itemReplyToSchema,
  answer: itemAnswerSchema,
  claimToken: nonEmptyStringSchema,
  leaseUntil: timestampSchema,
  attempts: z.number().int().positive(),
  createdAt: timestampSchema,
});

export const hermesResponseClaimResponseSchema = z.object({
  ok: z.literal(true),
  response: hermesResponseRecordSchema.optional(),
});

export const hermesResponseCompleteRequestSchema = z.object({
  claimToken: nonEmptyStringSchema,
  text: nonEmptyStringSchema.max(2_000).optional(),
});

// Hermes no longer holds the request: it expired, or Hermes restarted and forgot it.
export const hermesResponseFailRequestSchema = z.object({
  claimToken: nonEmptyStringSchema,
  reason: nonEmptyStringSchema.max(2_000),
});

// --- Heartbeat and status ----------------------------------------------------------------

const limitValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);

export const hermesCronJobSchema = z.object({
  id: nonEmptyStringSchema.max(200),
  name: nonEmptyStringSchema.max(500),
  schedule: z.string().max(200),
  lastRunAt: timestampSchema.optional(),
  lastStatus: nonEmptyStringSchema.max(100).optional(),
  nextRunAt: timestampSchema.optional(),
});

export const hermesCronIncidentSchema = z.object({
  id: nonEmptyStringSchema.max(200),
  jobId: nonEmptyStringSchema.max(200),
  state: nonEmptyStringSchema.max(50),
  failureType: nonEmptyStringSchema.max(100).optional(),
  firstSeenAt: timestampSchema.optional(),
  lastSeenAt: timestampSchema.optional(),
  error: z.string().max(2_000).optional(),
});

// The heartbeat body: what Hermes is doing right now.
export const hermesSnapshotSchema = z.object({
  platforms: z.array(nonEmptyStringSchema.max(100)).max(100),
  model: nonEmptyStringSchema.max(200).optional(),
  provider: nonEmptyStringSchema.max(200).optional(),
  cronJobs: z.array(hermesCronJobSchema).max(500),
  openIncidents: z.array(hermesCronIncidentSchema).max(500),
  kanban: z
    .object({ blocked: z.number().int().nonnegative(), running: z.number().int().nonnegative() })
    .optional(),
  budget: z.record(fieldNameSchema, limitValueSchema).optional(),
  rateLimits: z.record(fieldNameSchema, limitValueSchema).optional(),
});

// `heartbeatMissing` is Cowtail's call: no heartbeat for the watchdog's window.
export const hermesStatusResponseSchema = z.object({
  ok: z.literal(true),
  status: z
    .object({
      receivedAt: timestampSchema,
      heartbeatMissing: z.boolean(),
      snapshot: hermesSnapshotSchema,
    })
    .nullable(),
});

export type HermesResponseClaimRequest = z.infer<typeof hermesResponseClaimRequestSchema>;
export type HermesResponseRecord = z.infer<typeof hermesResponseRecordSchema>;
export type HermesResponseClaimResponse = z.infer<typeof hermesResponseClaimResponseSchema>;
export type HermesResponseCompleteRequest = z.infer<typeof hermesResponseCompleteRequestSchema>;
export type HermesResponseFailRequest = z.infer<typeof hermesResponseFailRequestSchema>;
export type HermesCronJob = z.infer<typeof hermesCronJobSchema>;
export type HermesCronIncident = z.infer<typeof hermesCronIncidentSchema>;
export type HermesSnapshot = z.infer<typeof hermesSnapshotSchema>;
export type HermesStatusResponse = z.infer<typeof hermesStatusResponseSchema>;
