export type RealtimeConfig = {
  bridgeToken: string;
  convexUrl: string;
  httpBaseUrl: string;
  pushBearerToken: string;
  ownerUserId: string;
  realtimeConvexToken: string;
  port: number;
};

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requiredAny(env: Env, names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

function parsePort(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 8787;
  }

  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  const parsed = Number(trimmed);
  if (parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return parsed;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadRealtimeConfig(env: Env): RealtimeConfig {
  const httpBaseUrl = stripTrailingSlash(required(env, "COWTAIL_HTTP_BASE_URL"));
  if (!httpBaseUrl) {
    throw new Error("Invalid COWTAIL_HTTP_BASE_URL: must not be empty after normalization");
  }

  return {
    bridgeToken: required(env, "OPENCLAW_COWTAIL_BRIDGE_TOKEN"),
    convexUrl: requiredAny(env, ["CONVEX_URL", "VITE_CONVEX_URL"]),
    httpBaseUrl,
    pushBearerToken: requiredAny(env, ["PUSH_API_BEARER_TOKEN", "COWTAIL_PUSH_API_BEARER_TOKEN"]),
    ownerUserId: required(env, "COWTAIL_OPENCLAW_OWNER_USER_ID"),
    realtimeConvexToken: required(env, "COWTAIL_REALTIME_CONVEX_TOKEN"),
    port: parsePort(env.PORT),
  };
}
