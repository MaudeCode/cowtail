import { pushResultSchema, type OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PushBridgeResult = {
  ok: boolean;
  sent: number;
  failed: number;
};

export type CowtailHttpPushBridgeOptions = {
  httpBaseUrl: string;
  bearerToken: string;
  ownerUserId: string;
  fetchImpl?: FetchLike;
};

export interface OpenClawPushBridge {
  sendOpenClawMessageNotification(event: OpenClawEventEnvelope): Promise<PushBridgeResult>;
}

export function truncateBody(value: string, maxLength = 180): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function failure(): PushBridgeResult {
  return { ok: false, sent: 0, failed: 1 };
}

export class CowtailHttpPushBridge implements OpenClawPushBridge {
  private readonly httpBaseUrl: string;
  private readonly bearerToken: string;
  private readonly ownerUserId: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: CowtailHttpPushBridgeOptions) {
    this.httpBaseUrl = options.httpBaseUrl.replace(/\/+$/, "");
    this.bearerToken = options.bearerToken;
    this.ownerUserId = options.ownerUserId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendOpenClawMessageNotification(event: OpenClawEventEnvelope): Promise<PushBridgeResult> {
    if (
      !event.threadId ||
      !event.messageId ||
      !event.message ||
      typeof event.message.text !== "string" ||
      event.message.text.trim().length === 0
    ) {
      return failure();
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.httpBaseUrl}/api/push/send`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.bearerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: this.ownerUserId,
          title: `OpenClaw: ${event.thread?.title ?? "Message"}`,
          body: truncateBody(event.message.text),
          data: { kind: "openclaw", threadId: event.threadId, messageId: event.messageId },
        }),
      });
    } catch {
      return failure();
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return failure();
    }

    if (!response.ok) {
      return failure();
    }

    const parsed = pushResultSchema.safeParse(json);
    if (!parsed.success) {
      return failure();
    }

    return {
      ok: parsed.data.ok,
      sent: parsed.data.sent,
      failed: parsed.data.failed,
    };
  }
}
