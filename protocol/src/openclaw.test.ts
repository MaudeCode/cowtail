import { describe, expect, test } from "bun:test";

import {
  openclawActionSubmittedEventSchema,
  openclawActionRecordSchema,
  openclawClientHelloSchema,
  openclawDisplayPreferencesResponseSchema,
  openclawDisplayPreferencesUpdateRequestSchema,
  openclawEventEnvelopeSchema,
  openclawMessageWithActionsRecordSchema,
  openclawMessageWithActionsListResponseSchema,
  openclawMessageRecordSchema,
  openclawReplayQuerySchema,
  openclawRealtimeClientMessageSchema,
  openclawRealtimeServerMessageSchema,
  openclawThreadRecordSchema,
  openclawToolCallRecordSchema,
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

  test("parses hydrated message_created envelope with actions", () => {
    const action = openclawActionRecordSchema.parse({
      id: "action-1",
      threadId: "thread-1",
      messageId: "message-1",
      label: "Approve",
      kind: "approval",
      payload: { decision: "approve" },
      state: "pending",
      createdAt: 6,
      updatedAt: 7,
    });

    const envelope = openclawEventEnvelopeSchema.parse({
      sequence: 12,
      type: "message_created",
      createdAt: 8,
      threadId: "thread-1",
      messageId: "message-1",
      actions: [action],
    });

    expect(envelope.actions).toEqual([action]);
  });

  test("parses OpenClaw tool call records", () => {
    expect(
      openclawToolCallRecordSchema.parse({
        id: "tool-1",
        name: "read_file",
        args: { path: "/var/log/app.log" },
        result: { lines: 20 },
        status: "complete",
        startedAt: 100,
        completedAt: 125,
        insertedAtContentLength: 12,
        contentSnapshotAtStart: "Checking logs",
      }),
    ).toEqual({
      id: "tool-1",
      name: "read_file",
      args: { path: "/var/log/app.log" },
      result: { lines: 20 },
      status: "complete",
      startedAt: 100,
      completedAt: 125,
      insertedAtContentLength: 12,
      contentSnapshotAtStart: "Checking logs",
    });
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
      idempotencyKey: "cowtail:reply:message-1",
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
    expect(parsed.idempotencyKey).toBe("cowtail:reply:message-1");
    expect(parsed.actions).toEqual([
      {
        label: "Approve",
        kind: "approval",
        payload: { decision: "approve" },
      },
    ]);

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "openclaw_message_update",
        requestId: "request-1b",
        idempotencyKey: "cowtail:update:message-1:sent",
        messageId: "message-1",
        text: "Streaming reply",
        links: [],
        deliveryState: "pending",
      }),
    ).toEqual({
      type: "openclaw_message_update",
      requestId: "request-1b",
      idempotencyKey: "cowtail:update:message-1:sent",
      messageId: "message-1",
      text: "Streaming reply",
      links: [],
      deliveryState: "pending",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "openclaw_message",
        requestId: "request-tool",
        idempotencyKey: "cowtail:reply:message-tool",
        sessionKey: "session-1",
        text: "",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            status: "complete",
          },
        ],
      }),
    ).toEqual({
      type: "openclaw_message",
      requestId: "request-tool",
      idempotencyKey: "cowtail:reply:message-tool",
      sessionKey: "session-1",
      text: "",
      links: [],
      toolCalls: [
        {
          id: "tool-1",
          name: "read_file",
          status: "complete",
        },
      ],
      actions: [],
    });

    expect(
      openclawRealtimeClientMessageSchema.safeParse({
        type: "openclaw_message",
        requestId: "request-empty",
        sessionKey: "session-1",
        text: "",
      }).success,
    ).toBe(false);

    expect(
      openclawRealtimeClientMessageSchema.safeParse({
        type: "openclaw_message_update",
        requestId: "request-empty-update",
        messageId: "message-1",
        text: "",
      }).success,
    ).toBe(false);
  });

  test("parses realtime-only OpenClaw stream snapshot commands and server messages", () => {
    const command = openclawRealtimeClientMessageSchema.parse({
      type: "openclaw_message_stream_snapshot",
      requestId: "stream-request-1",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "Hello from the live stream",
      isFinal: false,
      updatedAt: 1777939200000,
    });

    expect(command).toEqual({
      type: "openclaw_message_stream_snapshot",
      requestId: "stream-request-1",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "Hello from the live stream",
      links: [],
      toolCalls: [],
      isFinal: false,
      updatedAt: 1777939200000,
    });

    const serverMessage = openclawRealtimeServerMessageSchema.parse({
      type: "openclaw_message_stream_snapshot",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "Hello from the live stream",
      links: [],
      toolCalls: [],
      isFinal: false,
      updatedAt: 1777939200000,
    });

    expect(serverMessage).toEqual({
      type: "openclaw_message_stream_snapshot",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "Hello from the live stream",
      links: [],
      toolCalls: [],
      isFinal: false,
      updatedAt: 1777939200000,
    });
  });

  test("parses tool-call-only OpenClaw stream snapshots with default links", () => {
    const parsed = openclawRealtimeClientMessageSchema.parse({
      type: "openclaw_message_stream_snapshot",
      requestId: "stream-request-tool",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "",
      toolCalls: [
        {
          id: "tool-1",
          name: "read_file",
          status: "running",
          insertedAtContentLength: 0,
        },
      ],
      isFinal: false,
      updatedAt: 1777939200001,
    });

    const serverParsed = openclawRealtimeServerMessageSchema.parse({
      type: "openclaw_message_stream_snapshot",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "",
      toolCalls: [
        {
          id: "tool-1",
          name: "read_file",
          status: "running",
          insertedAtContentLength: 0,
        },
      ],
      isFinal: false,
      updatedAt: 1777939200001,
    });

    expect(parsed).toEqual({
      type: "openclaw_message_stream_snapshot",
      requestId: "stream-request-tool",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "",
      links: [],
      toolCalls: [
        {
          id: "tool-1",
          name: "read_file",
          status: "running",
          insertedAtContentLength: 0,
        },
      ],
      isFinal: false,
      updatedAt: 1777939200001,
    });
    expect(serverParsed).toEqual({
      type: "openclaw_message_stream_snapshot",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "",
      links: [],
      toolCalls: [
        {
          id: "tool-1",
          name: "read_file",
          status: "running",
          insertedAtContentLength: 0,
        },
      ],
      isFinal: false,
      updatedAt: 1777939200001,
    });
  });

  test("rejects blank OpenClaw stream snapshots", () => {
    expect(
      openclawRealtimeClientMessageSchema.safeParse({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-blank",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "",
        links: [],
        toolCalls: [],
        isFinal: false,
        updatedAt: 1777939200000,
      }).success,
    ).toBe(false);
    expect(
      openclawRealtimeServerMessageSchema.safeParse({
        type: "openclaw_message_stream_snapshot",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "",
        links: [],
        toolCalls: [],
        isFinal: false,
        updatedAt: 1777939200000,
      }).success,
    ).toBe(false);
  });

  test("parses realtime iOS commands", () => {
    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_new_thread",
        requestId: "request-2",
        idempotencyKey: "ios:new-thread:request-2",
        title: "Check backup",
        text: "Can you inspect the latest backup?",
      }),
    ).toEqual({
      type: "ios_new_thread",
      requestId: "request-2",
      idempotencyKey: "ios:new-thread:request-2",
      title: "Check backup",
      text: "Can you inspect the latest backup?",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_reply",
        requestId: "request-3",
        idempotencyKey: "ios:reply:request-3",
        threadId: "thread-1",
        text: "Run it now.",
      }),
    ).toEqual({
      type: "ios_reply",
      requestId: "request-3",
      idempotencyKey: "ios:reply:request-3",
      threadId: "thread-1",
      text: "Run it now.",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_action",
        requestId: "request-4",
        idempotencyKey: "ios:action:request-4",
        actionId: "action-1",
        payload: { decision: "approve" },
      }),
    ).toEqual({
      type: "ios_action",
      requestId: "request-4",
      idempotencyKey: "ios:action:request-4",
      actionId: "action-1",
      payload: { decision: "approve" },
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_mark_thread_read",
        requestId: "request-4b",
        idempotencyKey: "ios:mark-read:request-4b",
        threadId: "thread-1",
      }),
    ).toEqual({
      type: "ios_mark_thread_read",
      requestId: "request-4b",
      idempotencyKey: "ios:mark-read:request-4b",
      threadId: "thread-1",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_rename_thread",
        requestId: "request-4c",
        idempotencyKey: "ios:rename:request-4c",
        threadId: "thread-1",
        title: "Better title",
      }),
    ).toEqual({
      type: "ios_rename_thread",
      requestId: "request-4c",
      idempotencyKey: "ios:rename:request-4c",
      threadId: "thread-1",
      title: "Better title",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "ios_delete_thread",
        requestId: "request-4d",
        idempotencyKey: "ios:delete:request-4d",
        threadId: "thread-1",
      }),
    ).toEqual({
      type: "ios_delete_thread",
      requestId: "request-4d",
      idempotencyKey: "ios:delete:request-4d",
      threadId: "thread-1",
    });

    expect(
      openclawRealtimeClientMessageSchema.safeParse({
        type: "ios_reply",
        requestId: "request-empty",
        threadId: "thread-1",
        text: "",
      }).success,
    ).toBe(false);
  });

  test("parses realtime session binding and action result commands", () => {
    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "openclaw_session_bound",
        requestId: "request-5",
        idempotencyKey: "cowtail:session-bound:thread-1",
        threadId: "thread-1",
        sessionKey: "session-1",
      }),
    ).toEqual({
      type: "openclaw_session_bound",
      requestId: "request-5",
      idempotencyKey: "cowtail:session-bound:thread-1",
      threadId: "thread-1",
      sessionKey: "session-1",
    });

    expect(
      openclawRealtimeClientMessageSchema.parse({
        type: "openclaw_action_result",
        requestId: "request-6",
        idempotencyKey: "cowtail:action-result:action-1:submitted",
        actionId: "action-1",
        state: "submitted",
        resultMetadata: { accepted: true },
      }),
    ).toEqual({
      type: "openclaw_action_result",
      requestId: "request-6",
      idempotencyKey: "cowtail:action-result:action-1:submitted",
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
        payload: { threadId: "thread-1", messageId: "message-1" },
      }),
    ).toEqual({
      type: "ack",
      requestId: "request-7",
      sequence: 42,
      payload: { threadId: "thread-1", messageId: "message-1" },
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

  test("parses OpenClaw display preferences", () => {
    expect(
      openclawDisplayPreferencesResponseSchema.parse({
        ok: true,
        preferences: {
          displayName: "Maude",
        },
      }),
    ).toEqual({
      ok: true,
      preferences: {
        displayName: "Maude",
      },
    });

    expect(
      openclawDisplayPreferencesUpdateRequestSchema.parse({
        displayName: "  Maude  ",
      }),
    ).toEqual({
      displayName: "Maude",
    });
  });

  test("parses OpenClaw messages with embedded actions", () => {
    const message = openclawMessageWithActionsRecordSchema.parse({
      id: "message-1",
      threadId: "thread-1",
      direction: "openclaw_to_user",
      authorLabel: "OpenClaw",
      text: "Approve rollout?",
      links: [],
      deliveryState: "sent",
      createdAt: 1777128000000,
      updatedAt: 1777128000000,
      actions: [
        {
          id: "action-1",
          threadId: "thread-1",
          messageId: "message-1",
          label: "Approve",
          kind: "decision",
          payload: { decision: "approve" },
          state: "pending",
          createdAt: 1777128000001,
          updatedAt: 1777128000001,
        },
      ],
    });

    expect(message.actions[0]?.label).toBe("Approve");

    expect(
      openclawMessageWithActionsListResponseSchema.parse({
        ok: true,
        count: 1,
        messages: [message],
      }).count,
    ).toBe(1);
  });
});
