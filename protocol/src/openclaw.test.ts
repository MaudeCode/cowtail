import { describe, expect, test } from "bun:test";

import {
  openclawActionSubmittedEventSchema,
  openclawClientHelloSchema,
  openclawEventEnvelopeSchema,
  openclawMessageRecordSchema,
  openclawReplayQuerySchema,
  openclawRealtimeClientMessageSchema,
  openclawRealtimeServerMessageSchema,
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

  test("parses realtime OpenClaw plugin message command", () => {
    const parsed = openclawRealtimeClientMessageSchema.parse({
      type: "openclaw_message",
      requestId: "request-1",
      sessionKey: "session-1",
      title: "Deploy approval",
      text: "Approve production deploy?",
      authorLabel: "OpenClaw",
      links: [{ label: "Run", url: "https://cowtail.example.invalid/runs/1" }],
      actions: [
        {
          label: "Approve",
          kind: "approval",
          payload: { decision: "approve" },
        },
      ],
    });

    if (parsed.type !== "openclaw_message") {
      throw new Error("unexpected parsed realtime message type");
    }

    expect(parsed.type).toBe("openclaw_message");
    expect(parsed.actions).toEqual([
      {
        label: "Approve",
        kind: "approval",
        payload: { decision: "approve" },
      },
    ]);
  });

  test("parses realtime iOS commands", () => {
    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_new_thread",
        requestId: "request-2",
        title: "Check backup",
        text: "Can you inspect the latest backup?",
      }),
    ).toEqual({
      type: "ios_new_thread",
      requestId: "request-2",
      title: "Check backup",
      text: "Can you inspect the latest backup?",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_reply",
        requestId: "request-3",
        threadId: "thread-1",
        text: "Run it now.",
      }),
    ).toEqual({
      type: "ios_reply",
      requestId: "request-3",
      threadId: "thread-1",
      text: "Run it now.",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_action",
        requestId: "request-4",
        actionId: "action-1",
        payload: { decision: "approve" },
      }),
    ).toEqual({
      type: "ios_action",
      requestId: "request-4",
      actionId: "action-1",
      payload: { decision: "approve" },
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_mark_thread_read",
        requestId: "request-4b",
        threadId: "thread-1",
      }),
    ).toEqual({
      type: "ios_mark_thread_read",
      requestId: "request-4b",
      threadId: "thread-1",
    });
  });

  test("parses realtime session binding and action result commands", () => {
    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "openclaw_session_bound",
        requestId: "request-5",
        threadId: "thread-1",
        sessionKey: "session-1",
      }),
    ).toEqual({
      type: "openclaw_session_bound",
      requestId: "request-5",
      threadId: "thread-1",
      sessionKey: "session-1",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "openclaw_action_result",
        requestId: "request-6",
        actionId: "action-1",
        state: "submitted",
        resultMetadata: { accepted: true },
      }),
    ).toEqual({
      type: "openclaw_action_result",
      requestId: "request-6",
      actionId: "action-1",
      state: "submitted",
      resultMetadata: { accepted: true },
    });

    const invalidActionResult = openclawRealtimeClientMessageSchema.safeParse({
      type: "openclaw_action_result",
      requestId: "",
      actionId: "action-1",
      state: "submitted",
    });

    expect(invalidActionResult.success).toBe(false);
  });

  test("parses realtime server ack and error messages", () => {
    expect(
      openclawRealtimeServerMessageSchema.parse({
        type: "ack",
        requestId: "request-7",
        sequence: 42,
      }),
    ).toEqual({
      type: "ack",
      requestId: "request-7",
      sequence: 42,
    });

    expect(
      openclawRealtimeServerMessageSchema.parse({
        type: "realtime_error",
        requestId: "request-8",
        error: "Unauthorized",
      }),
    ).toEqual({
      type: "realtime_error",
      requestId: "request-8",
      error: "Unauthorized",
    });
  });
});
