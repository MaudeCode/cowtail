import { describe, expect, test } from "bun:test";

import {
  openclawActionSubmittedEventSchema,
  openclawClientHelloSchema,
  openclawEventEnvelopeSchema,
  openclawMessageRecordSchema,
  openclawReplayQuerySchema,
  openclawThreadRecordSchema,
} from "./openclaw.js";

describe("openclaw protocol schemas", () => {
  test("accepts plugin hello payload", () => {
    const parsed = openclawClientHelloSchema.parse({
      protocolVersion: 1,
      clientKind: "openclaw_plugin",
      token: "plugin-token",
      lastSeenSequence: 5,
    });

    expect(parsed).toEqual({
      protocolVersion: 1,
      clientKind: "openclaw_plugin",
      token: "plugin-token",
      lastSeenSequence: 5,
    });
  });

  test("rejects ios hello missing appSessionToken", () => {
    const result = openclawClientHelloSchema.safeParse({
      protocolVersion: 1,
      clientKind: "ios",
    });

    expect(result.success).toBe(false);
  });

  test("parses thread, message and message_created envelope", () => {
    const thread = openclawThreadRecordSchema.parse({
      id: "thread-1",
      status: "active",
      targetAgent: "default",
      title: "Thread title",
      unreadCount: 1,
      createdAt: 1,
      updatedAt: 2,
    });

    const message = openclawMessageRecordSchema.parse({
      id: "message-1",
      threadId: "thread-1",
      direction: "user_to_openclaw",
      text: "ping",
      deliveryState: "sent",
      createdAt: 3,
      updatedAt: 4,
    });

    const envelope = openclawEventEnvelopeSchema.parse({
      sequence: 10,
      type: "message_created",
      createdAt: 5,
      threadId: "thread-1",
      messageId: "message-1",
      thread,
      message,
    });

    expect(envelope.thread).toEqual(thread);
    expect(envelope.message).toEqual(message);
  });

  test("parses action_submitted event with required payload", () => {
    const actionSubmitted = openclawActionSubmittedEventSchema.parse({
      sequence: 11,
      type: "action_submitted",
      createdAt: 6,
      threadId: "thread-1",
      actionId: "action-1",
      payload: {
        kind: "submit",
        data: { example: true },
      },
    });

    expect(actionSubmitted.type).toBe("action_submitted");
    expect(actionSubmitted.payload).toEqual({
      kind: "submit",
      data: { example: true },
    });
  });

  test("replay query schema accepts defaults and rejects negative afterSequence", () => {
    const parsed = openclawReplayQuerySchema.parse({
      afterSequence: 10,
      limit: 100,
    });

    expect(parsed).toEqual({
      afterSequence: 10,
      limit: 100,
    });

    const emptyParsed = openclawReplayQuerySchema.parse({});
    expect(emptyParsed.limit).toBe(100);

    const negativeSequence = openclawReplayQuerySchema.safeParse({
      afterSequence: -1,
      limit: 100,
    });

    expect(negativeSequence.success).toBe(false);
  });
});
