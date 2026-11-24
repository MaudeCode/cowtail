import { z } from "zod";

import { hermesResponseClaimRequestSchema } from "./hermes.ts";
import { incidentSummarySchema, itemEventRecordSchema, itemRecordSchema } from "./items.ts";
import { nonEmptyStringSchema, timestampSchema } from "./shared.ts";

// --- Incidents ---------------------------------------------------------------------------
// Alert items from the same Alertmanager group that arrive within `incidentGroupWindowMs` of
// each other form an incident; one alert alone does not. The owner can also make one from
// chosen items, add an item and remove one. An incident resolves once every member is
// resolved or expired, or when the owner resolves it; it opens again when a member does.

export const incidentGroupWindowMs = 30 * 60 * 1000;

// `none` before the first resolution; `requested` while Hermes writes one; `failed` when no
// postmortem arrived within `incidentPostmortemTimeoutMs`.
export const incidentPostmortemStates = ["none", "requested", "written", "failed"] as const;
export const incidentPostmortemStateSchema = z.enum(incidentPostmortemStates);
export const incidentPostmortemTimeoutMs = 30 * 60 * 1000;

// What the owner can do with the incident now, besides adding and removing items:
// `resolve` while it is open, `request_postmortem` once it is resolved and no request is out.
export const incidentActionTypes = ["resolve", "request_postmortem"] as const;
export const incidentActionTypeSchema = z.enum(incidentActionTypes);

export const incidentRecordSchema = incidentSummarySchema.extend({
  createdAt: timestampSchema,
  postmortemState: incidentPostmortemStateSchema,
  // Markdown, as Hermes wrote it.
  postmortem: z.string().optional(),
  postmortemAt: timestampSchema.optional(),
  availableActions: z.array(incidentActionTypeSchema),
});

// One event of the merged timeline: a member's own event, or the incident's. `itemTitle` names
// the member it concerns.
export const incidentEventRecordSchema = itemEventRecordSchema.extend({
  itemTitle: z.string().optional(),
});

// The incident, its members, newest first, and the merged timeline, oldest first.
export const incidentGetResponseSchema = z.object({
  ok: z.literal(true),
  incident: incidentRecordSchema,
  members: z.array(itemRecordSchema),
  events: z.array(incidentEventRecordSchema),
});

// Without a title the incident takes its first item's.
export const incidentCreateRequestSchema = z.object({
  title: nonEmptyStringSchema.max(200).optional(),
  itemIds: z.array(nonEmptyStringSchema).min(1).max(100),
});

export const incidentAddItemRequestSchema = z.object({
  itemId: nonEmptyStringSchema,
});

// The items the owner can add: the newest 50 created in the last 7 days that belong to no
// incident.
export const incidentCandidatesResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(itemRecordSchema),
});

// --- Postmortems through Hermes ------------------------------------------------------------
// A resolution queues a postmortem request. The Hermes plugin claims it, hands `prompt` to
// Hermes as an inbound message in chat `chatId`, and confirms with /delivered, after which the
// request is never leased again. Hermes's reply to that chat is posted as the postmortem.

export const incidentChatPrefix = "cowtail:incident:";

export const postmortemRequestClaimRequestSchema = hermesResponseClaimRequestSchema;

export const postmortemRequestRecordSchema = z.object({
  id: nonEmptyStringSchema,
  incidentId: nonEmptyStringSchema,
  chatId: nonEmptyStringSchema,
  prompt: nonEmptyStringSchema,
  claimToken: nonEmptyStringSchema,
  leaseUntil: timestampSchema,
  attempts: z.number().int().positive(),
  createdAt: timestampSchema,
});

export const postmortemRequestClaimResponseSchema = z.object({
  ok: z.literal(true),
  request: postmortemRequestRecordSchema.optional(),
});

export const postmortemRequestDeliveredRequestSchema = z.object({
  claimToken: nonEmptyStringSchema,
});

export const incidentPostmortemPostRequestSchema = z.object({
  text: nonEmptyStringSchema.max(50_000),
});

export type IncidentPostmortemState = z.infer<typeof incidentPostmortemStateSchema>;
export type IncidentActionType = z.infer<typeof incidentActionTypeSchema>;
export type IncidentRecord = z.infer<typeof incidentRecordSchema>;
export type IncidentEventRecord = z.infer<typeof incidentEventRecordSchema>;
export type IncidentGetResponse = z.infer<typeof incidentGetResponseSchema>;
export type IncidentCreateRequest = z.infer<typeof incidentCreateRequestSchema>;
export type IncidentCandidatesResponse = z.infer<typeof incidentCandidatesResponseSchema>;
export type PostmortemRequestRecord = z.infer<typeof postmortemRequestRecordSchema>;
export type PostmortemRequestClaimResponse = z.infer<typeof postmortemRequestClaimResponseSchema>;
