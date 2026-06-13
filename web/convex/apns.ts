export type PushData = Record<string, unknown>;
export type ApnsEnvironment = "development" | "production";

const APNS_ENVIRONMENTS = new Set<ApnsEnvironment>(["development", "production"]);

const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

export function isInvalidDeviceTokenReason(reason?: string): boolean {
  return Boolean(reason && INVALID_TOKEN_REASONS.has(reason));
}

export function parseApnsEnvironment(value: string | undefined): ApnsEnvironment {
  const environment = value?.trim() || "development";
  if (APNS_ENVIRONMENTS.has(environment as ApnsEnvironment)) {
    return environment as ApnsEnvironment;
  }

  throw new Error(`Invalid APNS_ENV: ${environment}`);
}

export function configuredApnsEnvironment(): ApnsEnvironment {
  return parseApnsEnvironment(process.env.APNS_ENV);
}
