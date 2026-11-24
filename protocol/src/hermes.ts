import { z } from "zod";

import { fieldNameSchema, itemAnswerSchema, itemReplyToSchema } from "./items.ts";
import { runbookRunRecordSchema, runbookScriptSchema, runbookSectionSchema } from "./runbook.ts";
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
  // The MaudeUtils scripts the owner can run through Hermes, in MaudeUtils's order.
  runbook: z.array(runbookScriptSchema).max(500).optional(),
});

// How alive Hermes looks: green under 2 minutes since the last heartbeat, amber from 2 to 5
// minutes, red from 5 minutes or while the heartbeat-missing item is open.
export const hermesStatusLevels = ["green", "amber", "red"] as const;
export const hermesStatusLevelSchema = z.enum(hermesStatusLevels);

// A snapshot cron job with Cowtail's call on whether it is failing: its last run failed, or an
// open incident names it.
export const hermesStatusCronJobSchema = hermesCronJobSchema.extend({ failing: z.boolean() });

// An open incident with its job's name and the Cowtail item whose dedupeKey is
// `cron-incident:<id>`, when there is one.
export const hermesStatusIncidentSchema = hermesCronIncidentSchema.extend({
  jobName: nonEmptyStringSchema.optional(),
  itemId: nonEmptyStringSchema.optional(),
  itemTitle: nonEmptyStringSchema.optional(),
});

// An approval or question the owner answered in the last 7 days.
export const hermesRecentAnswerSchema = z.object({
  itemId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  answer: itemAnswerSchema,
  answeredAt: timestampSchema,
});

// `heartbeatMissing` and the rest after `snapshot` are Cowtail's calls; `snapshot` is what
// Hermes sent. The fields after `snapshot`, and `recentAnswers`, are optional so a client
// still decodes a server from before them.
export const hermesStatusResponseSchema = z.object({
  ok: z.literal(true),
  status: z
    .object({
      receivedAt: timestampSchema,
      heartbeatMissing: z.boolean(),
      snapshot: hermesSnapshotSchema,
      statusLevel: hermesStatusLevelSchema.optional(),
      // The snapshot's jobs, failing first, otherwise in Hermes's order.
      cronJobs: z.array(hermesStatusCronJobSchema).optional(),
      cronJobCount: z.number().int().nonnegative().optional(),
      failingCronCount: z.number().int().nonnegative().optional(),
      // The snapshot's open incidents, in Hermes's order.
      incidents: z.array(hermesStatusIncidentSchema).optional(),
      incidentCount: z.number().int().nonnegative().optional(),
      // Hermes has blocked kanban work, which the apps show as a warning.
      kanbanBlocked: z.boolean().optional(),
      // The snapshot's budget and rate-limit keys in the order to show them.
      budgetOrder: z.array(z.string()).optional(),
      rateLimitOrder: z.array(z.string()).optional(),
      // The snapshot's runbook, one section per category.
      runbook: z.array(runbookSectionSchema).optional(),
    })
    .nullable(),
  // Newest answer first, at most 20.
  recentAnswers: z.array(hermesRecentAnswerSchema).optional(),
  // Newest runbook run first, at most 10.
  recentRuns: z.array(runbookRunRecordSchema).optional(),
});

export type HermesResponseClaimRequest = z.infer<typeof hermesResponseClaimRequestSchema>;
export type HermesResponseRecord = z.infer<typeof hermesResponseRecordSchema>;
export type HermesResponseClaimResponse = z.infer<typeof hermesResponseClaimResponseSchema>;
export type HermesResponseCompleteRequest = z.infer<typeof hermesResponseCompleteRequestSchema>;
export type HermesResponseFailRequest = z.infer<typeof hermesResponseFailRequestSchema>;
export type HermesCronJob = z.infer<typeof hermesCronJobSchema>;
export type HermesCronIncident = z.infer<typeof hermesCronIncidentSchema>;
export type HermesSnapshot = z.infer<typeof hermesSnapshotSchema>;
export type HermesStatusLevel = z.infer<typeof hermesStatusLevelSchema>;
export type HermesStatusCronJob = z.infer<typeof hermesStatusCronJobSchema>;
export type HermesStatusIncident = z.infer<typeof hermesStatusIncidentSchema>;
export type HermesRecentAnswer = z.infer<typeof hermesRecentAnswerSchema>;
export type HermesStatusResponse = z.infer<typeof hermesStatusResponseSchema>;
