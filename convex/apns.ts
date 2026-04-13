"use node";

import { connect, type IncomingHttpHeaders } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

export type PushData = Record<string, unknown>;

export type SendApnsNotificationArgs = {
  deviceToken: string;
  title: string;
  body: string;
  data?: PushData;
};

type ApnsConfig = {
  keyId: string;
  teamId: string;
  topic: string;
  environment: "development" | "production";
  authKeyP8: string;
};

export type ApnsSuccess = {
  status: number;
  apnsId?: string;
};

export class ApnsError extends Error {
  status?: number;
  reason?: string;

  constructor(message: string, options?: { status?: number; reason?: string }) {
    super(message);
    this.name = "ApnsError";
    this.status = options?.status;
    this.reason = options?.reason;
  }
}

const INVALID_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "Unregistered",
]);

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ApnsError(`Missing required APNs env var: ${name}`);
  }
  return value;
}

function getApnsConfig(): ApnsConfig {
  const environment = (process.env.APNS_ENV?.trim() || "development") as "development" | "production";
  if (environment !== "development" && environment !== "production") {
    throw new ApnsError(`Invalid APNS_ENV: ${environment}`);
  }

  return {
    keyId: getRequiredEnv("APNS_KEY_ID"),
    teamId: getRequiredEnv("APNS_TEAM_ID"),
    topic: getRequiredEnv("APNS_TOPIC"),
    environment,
    authKeyP8: getRequiredEnv("APNS_AUTH_KEY_P8"),
  };
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function createApnsJwt(config: ApnsConfig): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = base64UrlEncode(JSON.stringify({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) }));
  const unsignedToken = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsignedToken), {
    key: createPrivateKey(config.authKeyP8),
    dsaEncoding: "ieee-p1363",
  });

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

function getApnsOrigin(environment: ApnsConfig["environment"]): string {
  return environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

function buildPayload(args: SendApnsNotificationArgs): string {
  return JSON.stringify({
    aps: {
      alert: {
        title: args.title,
        body: args.body,
      },
      sound: "default",
    },
    ...(args.data ?? {}),
  });
}

export async function sendApnsNotification(args: SendApnsNotificationArgs): Promise<ApnsSuccess> {
  const config = getApnsConfig();
  const origin = getApnsOrigin(config.environment);
  const jwt = createApnsJwt(config);
  const payload = buildPayload(args);

  return await new Promise<ApnsSuccess>((resolve, reject) => {
    const client = connect(origin);
    let status = 0;
    let responseBody = "";
    let apnsId: string | undefined;
    let settled = false;

    const cleanup = () => {
      if (!client.closed && !client.destroyed) {
        client.close();
      }
    };

    client.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(new ApnsError(`APNs connection error: ${error.message}`));
    });

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${args.deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload).toString(),
    });

    request.setEncoding("utf8");

    request.on("response", (headers: IncomingHttpHeaders) => {
      status = Number(headers[":status"] ?? 0);
      const headerValue = headers["apns-id"];
      apnsId = typeof headerValue === "string"
        ? headerValue
        : Array.isArray(headerValue)
        ? headerValue[0]
        : undefined;
    });

    request.on("data", (chunk: string) => {
      responseBody += chunk;
    });

    request.on("end", () => {
      cleanup();
      if (settled) return;
      settled = true;

      if (status >= 200 && status < 300) {
        resolve({ status, apnsId });
        return;
      }

      let reason: string | undefined;
      if (responseBody) {
        try {
          const parsed = JSON.parse(responseBody) as { reason?: string };
          reason = parsed.reason;
        } catch {
          // Ignore parse failures and fall back to raw body.
        }
      }

      reject(new ApnsError(
        `APNs request failed${reason ? `: ${reason}` : responseBody ? `: ${responseBody}` : ""}`,
        { status, reason },
      ));
    });

    request.on("error", (error: Error) => {
      cleanup();
      if (settled) return;
      settled = true;
      reject(new ApnsError(`APNs request error: ${error.message}`));
    });

    request.end(payload);
  });
}

export function isInvalidDeviceTokenReason(reason?: string): boolean {
  return Boolean(reason && INVALID_TOKEN_REASONS.has(reason));
}
