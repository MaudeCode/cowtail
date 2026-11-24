import { pushEnvironmentSchema, type PushEnvironment } from "@maudecode/cowtail-protocol";

import { v, type Infer } from "convex/values";

export type PushData = Record<string, unknown>;

// The `aps` fields an item push sets beyond its alert and sound.
export const apsExtrasValidator = v.object({
  // Lets the Notification Service Extension rewrite the push, to show its source's icon.
  mutableContent: v.optional(v.literal(1)),
  interruptionLevel: v.optional(
    v.union(v.literal("passive"), v.literal("active"), v.literal("time-sensitive")),
  ),
  threadId: v.optional(v.string()),
  badge: v.optional(v.number()),
  category: v.optional(v.string()),
});
export type ApsExtras = Infer<typeof apsExtrasValidator>;
export type ApnsEnvironment = PushEnvironment;

const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

export function isInvalidDeviceTokenReason(reason?: string): boolean {
  return Boolean(reason && INVALID_TOKEN_REASONS.has(reason));
}

export function parseApnsEnvironment(value: string | undefined): ApnsEnvironment {
  const environment = value?.trim() || "development";
  const parsed = pushEnvironmentSchema.safeParse(environment);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`Invalid APNS_ENV: ${environment}`);
}

export function configuredApnsEnvironment(): ApnsEnvironment {
  return parseApnsEnvironment(process.env.APNS_ENV);
}
