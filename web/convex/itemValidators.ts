import { itemEventTypes, itemKinds, itemStates, itemUrgencies } from "@maudecode/cowtail-protocol";
import { v } from "convex/values";

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)));

export const itemKindValidator = literals(itemKinds);
export const itemUrgencyValidator = literals(itemUrgencies);
export const itemStateValidator = literals(itemStates);
export const itemEventTypeValidator = literals(itemEventTypes);

export const quietHoursValidator = v.object({
  start: v.string(),
  end: v.string(),
  timeZone: v.string(),
});

export const itemActionValidator = v.union(
  v.object({ type: v.literal("approve") }),
  v.object({ type: v.literal("deny") }),
  v.object({ type: v.literal("choose"), options: v.array(v.string()) }),
  v.object({ type: v.literal("reply") }),
  v.object({ type: v.literal("snooze") }),
  v.object({ type: v.literal("ack") }),
  v.object({ type: v.literal("open"), url: v.string() }),
  v.object({
    type: v.literal("run"),
    scriptId: v.string(),
    label: v.string(),
    // The server's calls; the item record replaces whatever a producer sent.
    confirmText: v.optional(v.string()),
    needsAuth: v.optional(v.boolean()),
  }),
);

// The owner's answers; an item with a `replyTo` hands each one to its producer.
export const itemAnswerValidator = v.union(
  v.object({ type: v.literal("ack") }),
  v.object({ type: v.literal("approve") }),
  v.object({ type: v.literal("deny") }),
  v.object({ type: v.literal("choose"), option: v.string() }),
  v.object({ type: v.literal("reply"), text: v.string() }),
);

export const itemFields = {
  source: v.string(),
  kind: itemKindValidator,
  urgency: itemUrgencyValidator,
  state: itemStateValidator,
  title: v.string(),
  body: v.string(),
  links: v.array(v.object({ label: v.string(), url: v.string() })),
  context: v.record(v.string(), v.string()),
  dedupeKey: v.optional(v.string()),
  occurrenceCount: v.number(),
  actions: v.array(itemActionValidator),
  replyTo: v.optional(v.record(v.string(), v.any())),
  alertId: v.optional(v.id("alerts")),
  investigationJobId: v.optional(v.id("investigationJobs")),
  expiresAt: v.optional(v.number()),
  snoozedUntil: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  resolvedAt: v.optional(v.number()),
  answeredAt: v.optional(v.number()),
  // The newest hermes_update, kept as it is written so no reader scans the timeline.
  latestUpdate: v.optional(v.object({ text: v.string(), at: v.number() })),
  // The maintenance window that held back the item's push.
  maintenanceWindowId: v.optional(v.id("maintenanceWindows")),
};
