import { z } from "zod";

import {
  dateOnlyStringSchema,
  nonEmptyStringSchema,
  timestampSchema,
  timeZoneSchema,
} from "./shared.ts";
import { alertHumanActionSchema, investigationEvidenceSchema } from "./alerts.ts";
import { fixRecordSchema } from "./fixes.ts";
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
  "run_started",
  "run_finished",
  // Incident events: an item joined or left an incident, and its postmortem arrived. An
  // incident's own `created` and `resolved` reuse the item types above.
  "item_added",
  "item_removed",
  "postmortem_written",
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
  // Runs a runbook script for the item. In an item's `availableActions` the server adds the
  // script's `confirmText` and `needsAuth`, as the Hermes status shows them, and leaves out a
  // script Hermes no longer reports.
  z.object({
    type: z.literal("run"),
    scriptId: nonEmptyStringSchema.max(200),
    label: nonEmptyStringSchema.max(200),
    confirmText: z.string().optional(),
    needsAuth: z.boolean().optional(),
  }),
]);

// What an item's `availableActions` can list: a producer's actions, and the server's
// Unsnooze on a snoozed item, which no producer declares.
export const itemAvailableActionSchema = z.discriminatedUnion("type", [
  itemActionSchema,
  z.object({ type: z.literal("unsnooze") }),
]);

// Producer-owned routing data, returned to the producer untouched.
export const itemReplyToSchema = z.record(fieldNameSchema, z.unknown());

export const itemOutcomes = ["fixed", "self-resolved", "noise", "escalated", "other"] as const;
export const itemOutcomeSchema = z.enum(itemOutcomes);
// How far an open alert item's investigation has got.
export const itemInvestigationSteps = ["queued", "investigating", "failed"] as const;
export const itemInvestigationStepSchema = z.enum(itemInvestigationSteps);

// --- Incidents -----------------------------------------------------------------------------
// Related items, such as one outage's alerts, grouped into one incident with one timeline.

export const incidentStates = ["open", "resolved"] as const;
export const incidentStateSchema = z.enum(incidentStates);

// The incident an item belongs to, as its row shows it. `startedAt` is its first member's
// creation; `durationMs` runs from there to its resolution, or to now while it is open.
// `worstUrgency` is the highest urgency of its members, absent when it has none.
export const incidentSummarySchema = z.object({
  id: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  state: incidentStateSchema,
  memberCount: z.number().int().nonnegative(),
  worstUrgency: itemUrgencySchema.optional(),
  startedAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
  durationMs: z.number().int().nonnegative(),
});

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
  // Snoozed items only: whether the item needs the owner once it is open again, so an unsnooze
  // can show at once which section it returns to.
  needsOwnerWhenOpen: z.boolean().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
  // The rest the server derives for display. `subtitle` is the line under the title.
  subtitle: z.string().optional(),
  // When the owner answered (approve, deny, choose or reply); an answered item no longer
  // needs them while its producer applies the answer.
  answeredAt: timestampSchema.optional(),
  // What the owner can do with the item now: the producer's `actions`, with Acknowledge and
  // Snooze added while it is open and unanswered (no Acknowledge on an approval or question),
  // Unsnooze while it is snoozed, and no Acknowledge once acked. None once the item is closed
  // but its links, and no further answer once the owner answered. Always sent; optional so a
  // client still decodes a server from before it, and offers nothing then.
  availableActions: z.array(itemAvailableActionSchema).optional(),
  // The newest `hermes_update` on the timeline.
  latestUpdate: z.object({ text: z.string(), at: timestampSchema }).optional(),
  investigationStep: itemInvestigationStepSchema.optional(),
  // Resolved items only: how it ended, and how long after creation.
  outcome: itemOutcomeSchema.optional(),
  resolvedAfterMs: z.number().int().nonnegative().optional(),
  // The context keys in the order to show them.
  contextOrder: z.array(z.string()).optional(),
  // Alert items: the owner's calls on the alert the server accepts now, and the
  // investigation's recorded root cause and action.
  alertActions: z.array(alertHumanActionSchema).optional(),
  investigationResult: z
    .object({
      rootCause: z.string().optional(),
      action: z.string().optional(),
      // The note the owner gave when they marked the alert as noise or escalated it.
      ownerNote: z.string().optional(),
    })
    .optional(),
  // Answering this item's approve or deny needs Face ID: the owner's current setting.
  approvalNeedsAuth: z.boolean().optional(),
  // List results only: the day the item was created, in the server's time zone.
  createdDate: dateOnlyStringSchema.optional(),
  // Alert items only: the newest fix recorded against the item's alert.
  fix: fixRecordSchema.optional(),
  // The maintenance window that covered the item when Cowtail held back its push.
  maintenanceWindowId: nonEmptyStringSchema.optional(),
  // The incident the item belongs to. The inbox and item lists hold one member per incident,
  // which stands for the whole incident: the client shows it as the incident's row, which
  // opens the incident. The inbox puts it in the first section any member would be in.
  incident: incidentSummarySchema.optional(),
});

// An incident's own events carry `incidentId` and, when they concern one member, its `itemId`.
export const itemEventRecordSchema = z.object({
  id: nonEmptyStringSchema,
  itemId: nonEmptyStringSchema.optional(),
  incidentId: nonEmptyStringSchema.optional(),
  at: timestampSchema,
  type: itemEventTypeSchema,
  actor: nonEmptyStringSchema,
  payload: z.record(z.string(), z.unknown()),
  // A `hermes_update` from a finished investigation: the steps Hermes recorded, in order.
  evidence: investigationEvidenceSchema.optional(),
});

// An earlier firing of the same alert: the same Alertmanager fingerprint first, then the same
// alertname in the same namespace. `outcome` folds in the owner's call, as an item's does.
// `cause` and `fixCommit` are what a row shows: the root cause, or the summary when none was
// recorded, and the commit of the newest fix that names one.
export const priorOccurrenceSchema = z.object({
  alertId: nonEmptyStringSchema,
  firedAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
  outcome: itemOutcomeSchema,
  rootCause: z.string().optional(),
  summary: z.string(),
  ownerDisposition: z.enum(["noise", "escalated"]).optional(),
  cause: z.string(),
  fixCommit: nonEmptyStringSchema.optional(),
  fixes: z.array(
    z.object({
      description: nonEmptyStringSchema,
      rootCause: nonEmptyStringSchema,
      commit: nonEmptyStringSchema.optional(),
    }),
  ),
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
  // A reminder: an item with a future `remindAt` waits snoozed and silent until then, then
  // returns to the inbox and pushes once. A past `remindAt` creates it open as usual.
  remindAt: timestampSchema.optional(),
});

// A registered service can send an ordinary notification with text alone.
export const messageSendRequestSchema = z.strictObject({
  message: nonEmptyStringSchema.max(20_000),
  title: nonEmptyStringSchema.max(500).optional(),
  priority: z.enum(["normal", "urgent", "silent"]).optional(),
  links: z.array(itemLinkSchema).max(20).optional(),
  idempotencyKey: nonEmptyStringSchema.max(500).optional(),
});

export const messageAcceptedSchema = z.object({
  ok: z.literal(true),
  id: nonEmptyStringSchema,
  created: z.boolean(),
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

// A window ending now, which the server measures on its own clock. A `from` replaces it.
export const itemListRanges = ["24h", "7d", "30d", "90d"] as const;
export const itemListRangeSchema = z.enum(itemListRanges);
export type ItemListRange = z.infer<typeof itemListRangeSchema>;

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
  range: itemListRangeSchema.optional(),
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
  // The lower bound the server applied, a `range` resolved; a continuation sends it as `from`
  // so every page shares the first page's bounds.
  from: timestampSchema.optional(),
  // Each `createdDate` on this page, in page order, with how many items created that day
  // match the filters across the whole list, not only this page. A count reads at most the
  // day's first 1,000 items. Optional so a client still
  // decodes a server from before it.
  days: z
    .array(z.object({ date: dateOnlyStringSchema, count: z.number().int().nonnegative() }))
    .optional(),
});

// Every source with an item, in name order.
export const itemSourcesResponseSchema = z.object({
  ok: z.literal(true),
  sources: z.array(nonEmptyStringSchema),
});

// The owner's inbox: live work only; handled items are in History. Needs you: open items that
// need the owner. With Hermes: open and acked items that do not. Upcoming: snoozed items, the
// soonest `snoozedUntil` first. Every other list is the most recently updated first. Each
// reads at most 500 items of its states, and counts are of what it read.
export const itemInboxResponseSchema = z.object({
  ok: z.literal(true),
  counts: z.object({
    needsYou: z.number().int().nonnegative(),
    withHermes: z.number().int().nonnegative(),
    // Optional so a client still decodes a server from before it.
    upcoming: z.number().int().nonnegative().optional(),
  }),
  needsYou: z.array(itemRecordSchema),
  withHermes: z.array(itemRecordSchema),
  upcoming: z.array(itemRecordSchema).optional(),
  // The app badge, the same count every item push carries.
  badge: z.number().int().nonnegative(),
  // Every open item the owner has not answered, incidents' members included: the items whose
  // delivered notification stays. The app removes the others.
  liveItemIds: z.array(nonEmptyStringSchema),
});

export const itemGetResponseSchema = z.object({
  ok: z.literal(true),
  item: itemRecordSchema,
  events: z.array(itemEventRecordSchema),
  // Alert items: the fixes recorded against the alert, newest first. Optional so a client
  // still decodes a server from before it.
  fixes: z.array(fixRecordSchema).optional(),
  // Alert items: up to 3 earlier firings of the alert, newest first. Optional so a client
  // still decodes a server from before it.
  priorOccurrences: z.array(priorOccurrenceSchema).optional(),
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

// The snooze picker's choices: an hour and four hours from now, and 09:00 tomorrow and on the
// first Monday after today in the asking device's time zone. The client names each preset.
export const snoozePresets = ["1h", "4h", "tomorrow", "next_monday"] as const;
export const snoozeOptionsQuerySchema = z.object({ timeZone: timeZoneSchema });
export const snoozeOptionsResponseSchema = z.object({
  ok: z.literal(true),
  options: z.array(z.object({ preset: z.enum(snoozePresets), until: timestampSchema })),
});

// The generated iOS client names these variants by position: keep their order, and add new
// ones last. `unsnooze` returns a snoozed item to the inbox now.
export const itemActionRequestSchema = z.discriminatedUnion("type", [
  ackActionSchema,
  z.object({ type: z.literal("snooze"), until: timestampSchema }),
  ...answerActionSchemas,
  z.object({ type: z.literal("unsnooze") }),
]);

// Whether the owner passed Face ID for this Approve or Deny: in the app, or through a held
// notification whose category asked for it. While the owner requires Face ID for approvals,
// an answer sent with `false` is refused, so neither a stale app nor a notification delivered
// before the setting changed can answer without it.
export const itemActionQuerySchema = z.object({
  authenticated: z.boolean().optional(),
});

export const itemResponseSchema = z.object({
  ok: z.literal(true),
  item: itemRecordSchema,
});

const itemStatsMaxRangeMs = 92 * 24 * 60 * 60 * 1000;

// Without a range, the stats cover the last 7 days in the server's time zone, today included.
// A source, kind or outcome narrows them to the items History lists under that filter.
export const itemStatsQuerySchema = z
  .object({
    range: itemListRangeSchema.optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    source: itemSourceSchema.optional(),
    kind: itemKindSchema.optional(),
    outcome: itemOutcomeSchema.optional(),
  })
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
  // Every source in dailyVolume, most items first, in the order to stack and list them.
  // Optional so a client still decodes a server from before it.
  volumeSources: z.array(z.string()).optional(),
  firingCount: countSchema,
  // Most firing first.
  firingByNamespace: z.array(
    z.object({
      namespace: z.string(),
      count: countSchema,
      itemIds: z.array(nonEmptyStringSchema),
      // Each firing item's title once, in itemIds order. Optional so a client still decodes a
      // server from before it.
      titles: z.array(nonEmptyStringSchema).optional(),
    }),
  ),
});

// An alert item's metric graph: the alert's own Prometheus expression over a range ending now,
// or at the end of its firing when it resolved earlier.
export const itemGraphRanges = ["1h", "6h", "24h"] as const;
export const itemGraphRangeSchema = z.enum(itemGraphRanges);
export const itemGraphRangeMs = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
} as const satisfies Record<(typeof itemGraphRanges)[number], number>;
export const itemGraphMaxSeries = 10;
export const itemGraphMaxPoints = 120;

export const itemGraphQuerySchema = z.object({
  range: itemGraphRangeSchema.default("6h"),
});

export const itemGraphThresholdOps = [">", ">=", "<", "<=", "==", "!="] as const;

// `available: false` carries only the reason; the clients hide the graph. Otherwise `query` is
// the expression drawn: the alert's own, or its left side when it ends in a numeric comparison,
// which `threshold` then holds.
export const itemGraphResponseSchema = z.object({
  ok: z.literal(true),
  available: z.boolean(),
  reason: z.string().optional(),
  range: itemGraphRangeSchema,
  query: z.string().optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  threshold: z
    .object({
      op: z.enum(itemGraphThresholdOps),
      value: z.number(),
    })
    .optional(),
  firing: z
    .object({
      startsAt: timestampSchema,
      endsAt: timestampSchema.optional(),
    })
    .optional(),
  series: z
    .array(
      z.object({
        labels: z.record(z.string(), z.string()),
        points: z
          .array(z.object({ at: timestampSchema, value: z.number() }))
          .max(itemGraphMaxPoints),
      }),
    )
    .max(itemGraphMaxSeries)
    .optional(),
});

export type ItemKind = z.infer<typeof itemKindSchema>;
export type ItemUrgency = z.infer<typeof itemUrgencySchema>;
export type ItemState = z.infer<typeof itemStateSchema>;
export type ItemEventType = z.infer<typeof itemEventTypeSchema>;
export type ItemLink = z.infer<typeof itemLinkSchema>;
export type ItemAction = z.infer<typeof itemActionSchema>;
export type ItemAvailableAction = z.infer<typeof itemAvailableActionSchema>;
export type ItemRecord = z.infer<typeof itemRecordSchema>;
export type ItemEventRecord = z.infer<typeof itemEventRecordSchema>;
export type PriorOccurrence = z.infer<typeof priorOccurrenceSchema>;
export type ItemCreateRequest = z.infer<typeof itemCreateRequestSchema>;
export type ItemCreateResponse = z.infer<typeof itemCreateResponseSchema>;
export type ItemEventAppendRequest = z.infer<typeof itemEventAppendRequestSchema>;
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;
export type ItemGetResponse = z.infer<typeof itemGetResponseSchema>;
export type ItemAnswer = z.infer<typeof itemAnswerSchema>;
export type ItemInboxResponse = z.infer<typeof itemInboxResponseSchema>;
export type ItemSourcesResponse = z.infer<typeof itemSourcesResponseSchema>;
export type ItemInvestigationStep = z.infer<typeof itemInvestigationStepSchema>;
export type ItemActionRequest = z.infer<typeof itemActionRequestSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type ItemOutcome = (typeof itemOutcomes)[number];
export type ItemStatsQuery = z.infer<typeof itemStatsQuerySchema>;
export type ItemStatsResponse = z.infer<typeof itemStatsResponseSchema>;
export type SnoozePreset = (typeof snoozePresets)[number];
export type SnoozeOptionsResponse = z.infer<typeof snoozeOptionsResponseSchema>;
export type ItemGraphRange = z.infer<typeof itemGraphRangeSchema>;
export type ItemGraphResponse = z.infer<typeof itemGraphResponseSchema>;
export type IncidentState = z.infer<typeof incidentStateSchema>;
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;
