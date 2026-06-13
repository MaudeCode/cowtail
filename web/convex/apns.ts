import { pushEnvironmentSchema, type PushEnvironment } from "@maudecode/cowtail-protocol";

export type PushData = Record<string, unknown>;
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
