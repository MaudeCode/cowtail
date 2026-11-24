import { z } from "zod";

import { dateOnlyStringSchema, nonEmptyStringSchema, timestampSchema } from "./shared.ts";

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
// `source` is open: producers name themselves. These are the values Cowtail knows.
// `cowtail` marks Cowtail's own watchdog items, which maintenance windows never suppress.
export const knownItemSources = [
  "alertmanager",
  "hermes",
  "cron",
  "webhook",
  "manual",
  "cowtail",
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

export const itemRecordSchema = z.object({
  id: nonEmptyStringSchema,
  source: nonEmptyStringSchema,
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
});

export const itemEventRecordSchema = z.object({
  id: nonEmptyStringSchema,
  itemId: nonEmptyStringSchema,
  at: timestampSchema,
  type: itemEventTypeSchema,
  actor: nonEmptyStringSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const itemCreateRequestSchema = z.object({
  source: itemSourceSchema,
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
});

export const itemGetResponseSchema = z.object({
  ok: z.literal(true),
  item: itemRecordSchema,
  events: z.array(itemEventRecordSchema),
});

// The owner's answers to an item; a producer that set `replyTo` receives them.
export const itemAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ack") }),
  z.object({ type: z.literal("approve") }),
  z.object({ type: z.literal("deny") }),
  z.object({ type: z.literal("choose"), option: nonEmptyStringSchema }),
  z.object({ type: z.literal("reply"), text: nonEmptyStringSchema.max(20_000) }),
]);

export const itemActionRequestSchema = z.discriminatedUnion("type", [
  ...itemAnswerSchema.options,
  z.object({ type: z.literal("snooze"), until: timestampSchema }),
]);

export const itemResponseSchema = z.object({
  ok: z.literal(true),
  item: itemRecordSchema,
});

export const itemOutcomes = ["fixed", "self-resolved", "noise", "escalated", "other"] as const;
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
export type ItemActionRequest = z.infer<typeof itemActionRequestSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type ItemOutcome = (typeof itemOutcomes)[number];
export type ItemStatsQuery = z.infer<typeof itemStatsQuerySchema>;
export type ItemStatsResponse = z.infer<typeof itemStatsResponseSchema>;
