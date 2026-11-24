import { z } from "zod";

import { nonEmptyStringSchema, timestampSchema } from "./shared.ts";

// --- Maintenance windows -----------------------------------------------------------------
// Before planned work the owner starts a window. Alerts it covers are silenced in Alertmanager
// itself, and items it covers are still recorded but do not push. `now` items from Cowtail's
// own watchdogs always push.

// An alert label that must equal `value`, as in an Alertmanager equality matcher.
export const maintenanceMatcherSchema = z.object({
  label: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Expected an alert label name"),
  value: nonEmptyStringSchema.max(500),
});

// An item source, or `*` for every source.
export const maintenanceSourceSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^(\*|[a-z0-9][a-z0-9:_-]*)$/, "Expected a lowercase source name or *");

export const maintenanceWindowMaxDurationMs = 7 * 24 * 60 * 60 * 1000;

// A window covers the alerts whose labels equal every matcher, and every item from one of
// `sources`; the `alertmanager` source covers all alerts. With neither, it covers all alerts.
export const maintenanceWindowStartRequestSchema = z.object({
  title: nonEmptyStringSchema.max(200),
  durationMs: z.number().int().min(60_000).max(maintenanceWindowMaxDurationMs),
  matchers: z.array(maintenanceMatcherSchema).max(10).optional(),
  sources: z.array(maintenanceSourceSchema).max(20).optional(),
});

export const maintenanceWindowRecordSchema = z.object({
  id: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  // Set when the owner ended the window before `endsAt`.
  endedAt: timestampSchema.optional(),
  createdBy: nonEmptyStringSchema,
  matchers: z.array(maintenanceMatcherSchema),
  sources: z.array(maintenanceSourceSchema),
  // Whether the window silences every alert, whatever its labels.
  allAlerts: z.boolean(),
  // Whether the window is running now: started, not ended and not past `endsAt`.
  active: z.boolean(),
  // The Alertmanager silences the window created.
  silenceIds: z.array(nonEmptyStringSchema),
  // Why Alertmanager could not silence the window's alerts. Cowtail still holds back their
  // pushes.
  silenceError: z.string().optional(),
});

export const maintenanceWindowResponseSchema = z.object({
  ok: z.literal(true),
  window: maintenanceWindowRecordSchema,
});

// The running windows, the soonest end first, and the 20 newest windows that are over.
export const maintenanceWindowListResponseSchema = z.object({
  ok: z.literal(true),
  active: z.array(maintenanceWindowRecordSchema),
  recent: z.array(maintenanceWindowRecordSchema),
});

export type MaintenanceMatcher = z.infer<typeof maintenanceMatcherSchema>;
export type MaintenanceWindowStartRequest = z.infer<typeof maintenanceWindowStartRequestSchema>;
export type MaintenanceWindowRecord = z.infer<typeof maintenanceWindowRecordSchema>;
export type MaintenanceWindowResponse = z.infer<typeof maintenanceWindowResponseSchema>;
export type MaintenanceWindowListResponse = z.infer<typeof maintenanceWindowListResponseSchema>;
