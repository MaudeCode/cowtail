import { describe, expect, test } from "bun:test";

import { sendCowtailText } from "./outbound.js";
import type { CowtailCommandResult, OpenClawMessageInput } from "./client.js";
import type { ResolvedCowtailAccount } from "./types.js";

function createAccount(overrides: Partial<ResolvedCowtailAccount> = {}): ResolvedCowtailAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    url: "wss://cowtail.example.invalid/openclaw/realtime",
    bridgeToken: "bridge-token",
    bridgeTokenSource: "config",
    agentId: "main",
    connectTimeoutMs: 5_000,
    reconnectMinDelayMs: 100,
    reconnectMaxDelayMs: 250,
    ...overrides,
  };
}

type SentMessage = OpenClawMessageInput & { threadId: string };
type SendResult = CowtailCommandResult;

function createClient(overrides?: {
  sendOpenClawMessage?: (message: SentMessage) => Promise<SendResult>;
}) {
  const sentMessages: SentMessage[] = [];

  return {
    sentMessages,
    async sendOpenClawMessage(message: SentMessage) {
      sentMessages.push(message);
      if (overrides?.sendOpenClawMessage) {
        return overrides.sendOpenClawMessage(message);
      }
      return { requestId: "request-17", sequence: 17 };
    },
  };
}

describe("sendCowtailText", () => {
  test("sends openclaw_message with resolved thread id, target hint, and session fields", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => ({
        requestId: "request-17",
        sequence: 17,
        payload: { threadId: "thread_123", messageId: "message_123" },
      }),
    });

    const first = await sendCowtailText({
      account: createAccount(),
      client,
      to: "cowtail:thread_123",
      text: "Hello world",
    });
    const second = await sendCowtailText({
      account: createAccount(),
      client,
      to: "thread_123",
      text: "Hello world",
    });

    expect(client.sentMessages).toEqual([
      {
        type: "openclaw_message",
        sessionKey: "cowtail:thread_123",
        threadId: "thread_123",
        threadHint: "thread_123",
        text: "Hello world",
        links: [],
        actions: [],
      },
      {
        type: "openclaw_message",
        sessionKey: "cowtail:thread_123",
        threadId: "thread_123",
        threadHint: "thread_123",
        text: "Hello world",
        links: [],
        actions: [],
      },
    ]);
    expect(first).toEqual({
      channel: "cowtail",
      messageId: "message_123",
      to: "cowtail:thread_123",
    });
    expect(second).toEqual({
      channel: "cowtail",
      messageId: "message_123",
      to: "cowtail:thread_123",
    });
  });

  test("uses normalized outbound context thread id before target fallback", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => ({
        requestId: "request-17",
        sequence: 17,
        payload: { threadId: "thread_explicit", messageId: "message_123" },
      }),
    });

    await sendCowtailText({
      account: createAccount(),
      client,
      to: "cowtail:thread_target",
      threadId: "cowtail:thread_explicit",
      text: "Hello world",
    });

    expect(client.sentMessages).toEqual([
      {
        type: "openclaw_message",
        sessionKey: "cowtail:thread_target",
        threadId: "thread_explicit",
        threadHint: "thread_target",
        text: "Hello world",
        links: [],
        actions: [],
      },
    ]);
  });

  test("rejects acks without a durable message id", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => ({ requestId: "request-abc", sequence: undefined }),
    });

    await expect(
      sendCowtailText({
        account: createAccount(),
        client,
        to: "cowtail:thread_123",
        text: "Hello world",
      }),
    ).rejects.toThrow(/durable message id/i);
  });

  test("rejects acks whose durable message belongs to a different thread", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => ({
        requestId: "request-abc",
        sequence: 17,
        payload: { threadId: "thread_other", messageId: "message_123" },
      }),
    });

    await expect(
      sendCowtailText({
        account: createAccount(),
        client,
        to: "cowtail:thread_123",
        text: "Hello world",
      }),
    ).rejects.toThrow(/intended thread/i);
  });

  test("rejects acks with a durable message id but no intended thread", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => ({
        requestId: "request-abc",
        sequence: 17,
        payload: { messageId: "message_123" },
      }),
    });

    await expect(
      sendCowtailText({
        account: createAccount(),
        client,
        to: "cowtail:thread_123",
        text: "Hello world",
      }),
    ).rejects.toThrow(/intended thread/i);
  });

  test("rejects blank text before sending", async () => {
    const client = createClient();

    await expect(
      sendCowtailText({
        account: createAccount(),
        client,
        to: "thread_123",
        text: "   ",
      }),
    ).rejects.toThrow(/text/i);

    expect(client.sentMessages).toEqual([]);
  });

  test("propagates disconnected client errors as delivery failures", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => {
        throw new Error("Cowtail websocket closed");
      },
    });

    await expect(
      sendCowtailText({
        account: createAccount(),
        client,
        to: "thread_123",
        text: "Hello world",
      }),
    ).rejects.toThrow(/closed/i);
  });
});
