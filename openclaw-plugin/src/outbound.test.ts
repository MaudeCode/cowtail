import { describe, expect, test } from "bun:test";

import { sendCowtailText } from "./outbound.js";

type SentMessage = {
  type: "openclaw_message";
  sessionKey: string;
  text: string;
  links: [];
  actions: [];
};

type SendResult = {
  requestId: string;
  sequence: number | undefined;
};

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
  test("sends openclaw_message with a stable Cowtail session key", async () => {
    const client = createClient();

    const first = await sendCowtailText({
      client,
      to: "cowtail:thread_123",
      text: "Hello world",
    });
    const second = await sendCowtailText({
      client,
      to: "thread_123",
      text: "Hello world",
    });

    expect(client.sentMessages).toEqual([
      {
        type: "openclaw_message",
        sessionKey: "cowtail:thread_123",
        text: "Hello world",
        links: [],
        actions: [],
      },
      {
        type: "openclaw_message",
        sessionKey: "cowtail:thread_123",
        text: "Hello world",
        links: [],
        actions: [],
      },
    ]);
    expect(first).toEqual({
      channel: "cowtail",
      messageId: "17",
      to: "cowtail:thread_123",
    });
    expect(second).toEqual({
      channel: "cowtail",
      messageId: "17",
      to: "cowtail:thread_123",
    });
  });

  test("uses a request-id-like fallback when no sequence is returned", async () => {
    const client = createClient({
      sendOpenClawMessage: async () => ({ requestId: "request-abc", sequence: undefined }),
    });

    const result = await sendCowtailText({
      client,
      to: "cowtail:thread_123",
      text: "Hello world",
    });

    expect(result).toEqual({
      channel: "cowtail",
      messageId: "request-abc",
      to: "cowtail:thread_123",
    });
  });

  test("rejects blank text before sending", async () => {
    const client = createClient();

    await expect(
      sendCowtailText({
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
        client,
        to: "thread_123",
        text: "Hello world",
      }),
    ).rejects.toThrow(/closed/i);
  });
});
