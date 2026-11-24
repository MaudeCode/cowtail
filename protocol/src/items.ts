import { z } from "zod";

import { dateOnlyStringSchema, nonEmptyStringSchema, timestampSchema } from "./shared.ts";
import { sourceInfoSchema } from "./sources.ts";

export const itemKinds = ["alert", "failure", "approval", "question", "fyi", "done"] as const;
export const itemUrgencies = ["now", "today", "whenever"] as const;
export const itemStates = ["open", "acked", "snoozed", "resolved", "expired"] as const;
export const itemEventTypes = [
  "created",
  "repeated",
  "dispatched",
  "hermes_update",
  "notified",
  "action_taken",
  "state_changed",
  "resolved",
] as const;

export const itemKindSchema = z.enum(itemKinds);
export const itemUrgencySchema = z.enum(itemUrgencies);
export const itemStateSchema = z.enum(itemStates);
export const itemEventTypeSchema = z.enum(itemEventTypes);
export const itemSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9:_-]*$/, "Expected a lowercase source name");

const webUrlSchema = z.url({ protocol: /^https?$/ });
// Convex refuses empty keys and keys that start with `$` or `_`.
export const fieldNameSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "Expected a key of letters, digits, _ . : or -");

export const itemLinkSchema = z.object({
  label: nonEmptyStringSchema,
  url: webUrlSchema,
});

export const itemContextSchema = z.record(fieldNameSchema, z.string().max(2_000));

export const itemActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve") }),
  z.object({ type: z.literal("deny") }),
  z.object({ type: z.literal("choose"), options: z.array(nonEmptyStringSchema).min(1) }),
  z.object({ type: z.literal("reply") }),
  z.object({ type: z.literal("snooze") }),
  z.object({ type: z.literal("ack") }),
  z.object({ type: z.literal("open"), url: webUrlSchema }),
]);

// Producer-owned routing data, returned to the producer untouched.
export const itemReplyToSchema = z.record(fieldNameSchema, z.unknown());

export const itemOutcomes = ["fixed", "self-resolved", "noise", "escalated", "other"] as const;
export const itemOutcomeSchema = z.enum(itemOutcomes);
// How far an open alert item's investigation has got.
export const itemInvestigationSteps = ["queued", "investigating", "failed"] as const;
export const itemInvestigationStepSchema = z.enum(itemInvestigationSteps);

export const itemRecordSchema = z.object({
  id: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
  sourceInfo: sourceInfoSchema,
  kind: itemKindSchema,
  urgency: itemUrgencySchema,
  state: itemStateSchema,
  needsOwner: z.boolean(),
  title: nonEmptyStringSchema,
  body: z.string(),
  links: z.array(itemLinkSchema),
  context: itemContextSchema,
  dedupeKey: nonEmptyStringSchema.optional(),
  occurrenceCount: z.number().int().positive(),
  actions: z.array(itemActionSchema),
  replyTo: itemReplyToSchema.optional(),
  alertId: nonEmptyStringSchema.optional(),
  investigationJobId: nonEmptyStringSchema.optional(),
  expiresAt: timestampSchema.optional(),
  snoozedUntil: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
  // The rest the server derives for display. `subtitle` is the line under the title.
  subtitle: z.string().optional(),
  // When the owner answered (approve, deny, choose or reply); an answered item no longer
  // needs them while its producer applies the answer.
  answeredAt: timestampSchema.optional(),
  // The newest `hermes_update` on the timeline.
  latestUpdate: z.object({ text: z.string(), at: timestampSchema }).optional(),
  investigationStep: itemInvestigationStepSchema.optional(),
  // Resolved items only: how it ended, and how long after creation.
  outcome: itemOutcomeSchema.optional(),
  resolvedAfterMs: z.number().int().nonnegative().optional(),
  // List results only: the day the item was created, in the server's time zone.
  createdDate: dateOnlyStringSchema.optional(),
});

export const itemEventRecordSchema = z.object({
  id: nonEmptyStringSchema,
  itemId: nonEmptyStringSchema,
  at: timestampSchema,
  type: itemEventTypeSchema,
  actor: nonEmptyStringSchema,
  payload: z.record(z.string(), z.unknown()),
});

// A source token posts as its own source and ignores `source`; a service token must name a
// registered source.
export const itemCreateRequestSchema = z.object({
  source: itemSourceSchema.optional(),
  kind: itemKindSchema,
  urgency: itemUrgencySchema,
  title: nonEmptyStringSchema.max(500),
  body: z.string().max(20_000).optional(),
  links: z.array(itemLinkSchema).max(20).optional(),
  context: itemContextSchema.optional(),
  dedupeKey: nonEmptyStringSchema.max(500).optional(),
  actions: z.array(itemActionSchema).max(20).optional(),
  replyTo: itemReplyToSchema.optional(),
  expiresAt: timestampSchema.optional(),
});

export const itemCreateResponseSchema = z.object({
  ok: z.literal(true),
  id: nonEmptyStringSchema,
  created: z.boolean(),
  occurrenceCount: z.number().int().positive(),
});

export const itemEventAppendRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hermes_update"),
    text: nonEmptyStringSchema.max(20_000),
    actor: nonEmptyStringSchema.max(200).optional(),
  }),
  z.object({
    type: z.literal("state_changed"),
    to: z.enum(["resolved", "expired"]),
    reason: nonEmptyStringSchema.max(2_000).optional(),
    actor: nonEmptyStringSchema.max(200).optional(),
  }),
]);

// A state filter lists the most recently updated items first; any other list, the newest
// created first. A page reads at most `limit` items and can hold fewer once filtered; follow
// `nextCursor` until it is absent.
export const itemListQuerySchema = z.object({
  state: itemStateSchema.optional(),
  needsOwner: z.boolean().optional(),
  source: itemSourceSchema.optional(),
  kind: itemKindSchema.optional(),
  outcome: itemOutcomeSchema.optional(),
  alertId: nonEmptyStringSchema.optional(),
  // Matches title, subtitle and body, ignoring case.
  q: nonEmptyStringSchema.max(200).optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  cursor: nonEmptyStringSchema.optional(),
});

export const itemListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  items: z.array(itemRecordSchema),
  nextCursor: nonEmptyStringSchema.optional(),
  // Each `createdDate` on this page, in page order, with how many items created that day
  // match the filters across the whole list, not only this page. Optional so a client still
  // decodes a server from before it.
  days: z
    .array(z.object({ date: dateOnlyStringSchema, count: z.number().int().nonnegative() }))
    .optional(),
});

// The owner's inbox. Needs you: open items that need the owner. With Hermes: open and acked
// items that do not. Handled: items resolved in the last 24 hours. Each list is the most
// recently updated first.
export const itemInboxHandledWindowMs = 24 * 60 * 60 * 1000;
export const itemInboxResponseSchema = z.object({
  ok: z.literal(true),
  needsYou: z.array(itemRecordSchema),
  withHermes: z.array(itemRecordSchema),
  handled: z.array(itemRecordSchema),
});

export const itemGetResponseSchema = z.object({
  ok: z.literal(true),
  item: itemRecordSchema,
  events: z.array(itemEventRecordSchema),
});

const ackActionSchema = z.object({ type: z.literal("ack") });
const answerActionSchemas = [
  z.object({ type: z.literal("approve") }),
  z.object({ type: z.literal("deny") }),
  z.object({ type: z.literal("choose"), option: nonEmptyStringSchema }),
  z.object({ type: z.literal("reply"), text: nonEmptyStringSchema.max(20_000) }),
] as const;

// The owner's answers to an item; a producer that set `replyTo` receives them.
export const itemAnswerSchema = z.discriminatedUnion("type", [
  ackActionSchema,
  ...answerActionSchemas,
]);

// The generated iOS client names these variants by position: keep their order.
export const itemActionRequestSchema = z.discriminatedUnion("type", [
  ackActionSchema,
  z.object({ type: z.literal("snooze"), until: timestampSchema }),
  ...answerActionSchemas,
]);

export const itemResponseSchema = z.object({
  ok: z.literal(true),
  item: itemRecordSchema,
});

const itemStatsMaxRangeMs = 92 * 24 * 60 * 60 * 1000;

// Without a range, the stats cover the last 7 days in the server's time zone, today included.
export const itemStatsQuerySchema = z
  .object({ from: timestampSchema.optional(), to: timestampSchema.optional() })
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    message: "from must not be after to",
  })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || to - from <= itemStatsMaxRangeMs,
    { message: "The range can span at most 92 days" },
  );

const countSchema = z.number().int().nonnegative();
const shareSchema = z.number().min(0).max(1);

// Resolved means resolved within the range; created means created within it. Firing is the
// alert items that are not resolved or expired now, whatever the range.
export const itemStatsResponseSchema = z.object({
  ok: z.literal(true),
  from: timestampSchema,
  to: timestampSchema,
  timeZone: nonEmptyStringSchema,
  createdCount: countSchema,
  resolvedCount: countSchema,
  outcomeMix: z.object(
    Object.fromEntries(itemOutcomes.map((outcome) => [outcome, countSchema])) as Record<
      (typeof itemOutcomes)[number],
      typeof countSchema
    >,
  ),
  // Noise items divided by resolved items; 0 when nothing resolved.
  noiseRate: shareSchema,
  // One row per kind with a resolved item, in kind order; nearest-rank percentiles.
  timeToResolve: z.array(
    z.object({
      kind: itemKindSchema,
      count: countSchema,
      medianMs: countSchema,
      p90Ms: countSchema,
    }),
  ),
  // Created items grouped by dedupeKey (an alert's own key for alert items) that occurred
  // more than once; the 10 with the most occurrences. noiseShare weighs by occurrences, and
  // lastSeenAt is the last occurrence: the alert's last receipt or the item's newest repeat.
  repeatOffenders: z.array(
    z.object({
      dedupeKey: nonEmptyStringSchema,
      title: nonEmptyStringSchema,
      occurrenceCount: countSchema,
      noiseShare: shareSchema,
      lastSeenAt: timestampSchema,
    }),
  ),
  // Every day the range touches, oldest first, in timeZone.
  dailyVolume: z.array(
    z.object({
      date: dateOnlyStringSchema,
      total: countSchema,
      bySource: z.record(z.string(), countSchema),
    }),
  ),
  firingCount: countSchema,
  // Most firing first.
  firingByNamespace: z.array(
    z.object({
      namespace: z.string(),
      count: countSchema,
      itemIds: z.array(nonEmptyStringSchema),
    }),
  ),
});

export type ItemKind = z.infer<typeof itemKindSchema>;
export type ItemUrgency = z.infer<typeof itemUrgencySchema>;
export type ItemState = z.infer<typeof itemStateSchema>;
export type ItemEventType = z.infer<typeof itemEventTypeSchema>;
export type ItemLink = z.infer<typeof itemLinkSchema>;
export type ItemAction = z.infer<typeof itemActionSchema>;
export type ItemRecord = z.infer<typeof itemRecordSchema>;
export type ItemEventRecord = z.infer<typeof itemEventRecordSchema>;
export type ItemCreateRequest = z.infer<typeof itemCreateRequestSchema>;
export type ItemCreateResponse = z.infer<typeof itemCreateResponseSchema>;
export type ItemEventAppendRequest = z.infer<typeof itemEventAppendRequestSchema>;
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;
export type ItemGetResponse = z.infer<typeof itemGetResponseSchema>;
export type ItemAnswer = z.infer<typeof itemAnswerSchema>;
export type ItemInboxResponse = z.infer<typeof itemInboxResponseSchema>;
export type ItemInvestigationStep = z.infer<typeof itemInvestigationStepSchema>;
export type ItemActionRequest = z.infer<typeof itemActionRequestSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type ItemOutcome = (typeof itemOutcomes)[number];
export type ItemStatsQuery = z.infer<typeof itemStatsQuerySchema>;
export type ItemStatsResponse = z.infer<typeof itemStatsResponseSchema>;
