import { afterEach, describe, expect, test } from "bun:test";

import {
  createThreadFromOpenClaw,
  submitActionFromIos,
  updateMessageFromOpenClaw,
} from "./openclaw";
import {
  buildOpenClawActionResultUpdate,
  buildOpenClawEventPayload,
  buildOpenClawMessageUpdatePatch,
  applyOpenClawThreadTitlePatch,
  normalizeOpenClawTitle,
  shouldDropOpenClawReplyForThread,
  toOpenClawActionRecord,
  toOpenClawEventEnvelope,
  toOpenClawMessageWithActionsRecord,
  toOpenClawMessageRecord,
  toOpenClawThreadRecord,
  validateOpenClawAfterSequence,
  validateOpenClawToolCalls,
  validateOpenClawLimit,
  sortOpenClawMessagesAscending,
} from "./openclawModel";
import { parseOpenClawListLimit, requireOpenClawOwner } from "./http";

const originalOpenClawOwnerUserId = process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;
const originalRealtimeConvexToken = process.env.COWTAIL_REALTIME_CONVEX_TOKEN;

afterEach(() => {
  if (originalOpenClawOwnerUserId === undefined) {
    delete process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;
  } else {
    process.env.COWTAIL_OPENCLAW_OWNER_USER_ID = originalOpenClawOwnerUserId;
  }

  if (originalRealtimeConvexToken === undefined) {
    delete process.env.COWTAIL_REALTIME_CONVEX_TOKEN;
  } else {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = originalRealtimeConvexToken;
  }
});

type ConvexFunctionForTest = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

function convexHandler(fn: unknown) {
  return (fn as ConvexFunctionForTest)._handler;
}

function expectRequiredConvexArg(fn: unknown, argName: string) {
  const exportedArgs = (fn as { exportArgs: () => string }).exportArgs();
  const args = JSON.parse(exportedArgs) as {
    type: string;
    value: Record<string, { optional: boolean }>;
  };

  expect(args.type).toBe("object");
  expect(args.value[argName]?.optional).toBe(false);
}

function createArchivedDropMutationCtx(options: {
  existingThread?: Record<string, unknown>;
  message?: Record<string, unknown>;
  idempotentMessage?: Record<string, unknown>;
  idempotencyReceipt?: Record<string, unknown>;
  action?: Record<string, unknown>;
}) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const queryCalls: string[] = [];
  const getCalls: string[] = [];

  const ctx = {
    db: {
      query: (table: string) => {
        queryCalls.push(table);
        return {
          withIndex: () => ({
            order: () => ({
              collect: async () => [],
            }),
            collect: async () => {
              if (table === "openclawThreads") {
                return options.existingThread ? [options.existingThread] : [];
              }
              if (table === "openclawMessages") {
                return options.idempotentMessage ? [options.idempotentMessage] : [];
              }
              if (table === "openclawIdempotencyReceipts") {
                return options.idempotencyReceipt ? [options.idempotencyReceipt] : [];
              }
              if (table === "openclawState") {
                return [];
              }
              return [];
            },
          }),
        };
      },
      get: async (id: string) => {
        getCalls.push(id);
        if (options.message && id === options.message._id) {
          return options.message;
        }
        if (options.existingThread && id === options.existingThread._id) {
          return options.existingThread;
        }
        if (options.action && id === options.action._id) {
          return options.action;
        }
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}-id`;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  };

  return { ctx, getCalls, inserts, patches, queryCalls };
}

describe("OpenClaw Convex model helpers", () => {
  test("normalizes blank titles to Main", () => {
    expect(normalizeOpenClawTitle("")).toBe("Main");
    expect(normalizeOpenClawTitle("  deploy check  ")).toBe("deploy check");
  });

  test("patches existing thread title only for non-empty input", () => {
    expect(applyOpenClawThreadTitlePatch("Main", undefined)).toBe("Main");
    expect(applyOpenClawThreadTitlePatch("Main", "")).toBe("Main");
    expect(applyOpenClawThreadTitlePatch("Main", "   ")).toBe("Main");
    expect(applyOpenClawThreadTitlePatch("Main", "Follow up")).toBe("Follow up");
    expect(applyOpenClawThreadTitlePatch("Main", "  Follow up  ")).toBe("Follow up");
  });

  test("validates list limits and defaults", () => {
    expect(validateOpenClawLimit(undefined)).toBe(100);

    expect(validateOpenClawLimit(50)).toBe(50);

    expect(() => {
      validateOpenClawLimit(0);
    }).toThrow("limit must be an integer between 1 and 500");

    expect(() => {
      validateOpenClawLimit(-1);
    }).toThrow("limit must be an integer between 1 and 500");

    expect(() => {
      validateOpenClawLimit(12.5);
    }).toThrow("limit must be an integer between 1 and 500");

    expect(() => {
      validateOpenClawLimit(501);
    }).toThrow("limit must be an integer between 1 and 500");
  });

  test("parses OpenClaw HTTP list limits", () => {
    expect(parseOpenClawListLimit(undefined)).toEqual({ limit: undefined });
    expect(parseOpenClawListLimit("1")).toEqual({ limit: 1 });
    expect(parseOpenClawListLimit("500")).toEqual({ limit: 500 });

    expect(parseOpenClawListLimit("")).toEqual({
      error: "limit must be an integer between 1 and 500",
    });
    expect(parseOpenClawListLimit("0")).toEqual({
      error: "limit must be an integer between 1 and 500",
    });
    expect(parseOpenClawListLimit("501")).toEqual({
      error: "limit must be an integer between 1 and 500",
    });
    expect(parseOpenClawListLimit("12.5")).toEqual({
      error: "limit must be an integer between 1 and 500",
    });
    expect(parseOpenClawListLimit("abc")).toEqual({
      error: "limit must be an integer between 1 and 500",
    });
  });

  test("allows the configured OpenClaw owner", () => {
    process.env.COWTAIL_OPENCLAW_OWNER_USER_ID = "owner-user";

    expect(requireOpenClawOwner({ userId: "owner-user" })).toBeNull();
  });

  test("rejects OpenClaw owner checks when owner config is missing", async () => {
    delete process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;

    const response = requireOpenClawOwner({ userId: "owner-user" });

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(500);
    expect(await response?.json()).toEqual({
      ok: false,
      error: "OpenClaw owner user ID is not configured",
    });
  });

  test("rejects non-owner OpenClaw history access", async () => {
    process.env.COWTAIL_OPENCLAW_OWNER_USER_ID = "owner-user";

    const response = requireOpenClawOwner({ userId: "other-user" });

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      ok: false,
      error: "Forbidden",
    });
  });

  test("validates replay sequence cursor", () => {
    expect(validateOpenClawAfterSequence(undefined)).toBeUndefined();
    expect(validateOpenClawAfterSequence(0)).toBe(0);

    expect(() => {
      validateOpenClawAfterSequence(-1);
    }).toThrow("afterSequence must be a finite integer greater than or equal to 0");

    expect(() => {
      validateOpenClawAfterSequence(12.5);
    }).toThrow("afterSequence must be a finite integer greater than or equal to 0");
  });

  test("sorts messages by creation time", () => {
    const messages = [
      { _id: "b", createdAt: 20 },
      { _id: "a", createdAt: 10 },
      { _id: "c", createdAt: 20 },
    ];

    expect(sortOpenClawMessagesAscending(messages).map((message) => message._id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("does not mutate input when sorting", () => {
    const messages = [
      { _id: "2", createdAt: 200 },
      { _id: "1", createdAt: 100 },
      { _id: "3", createdAt: 150 },
    ];
    const expectedInputOrder = [...messages];

    const sortedMessages = sortOpenClawMessagesAscending(messages);

    expect(sortedMessages.map((message) => message._id)).toEqual(["1", "3", "2"]);
    expect(messages).toEqual(expectedInputOrder);
  });

  test("builds event payloads without undefined fields", () => {
    expect(
      buildOpenClawEventPayload({
        type: "message_created",
        threadId: "thread-id",
        messageId: undefined,
        payload: { ok: true },
      }),
    ).toEqual({
      type: "message_created",
      threadId: "thread-id",
      payload: { ok: true },
    });
  });

  test("preserves defined falsy event payload values while dropping undefined", () => {
    expect(
      buildOpenClawEventPayload({
        type: "message_acknowledged",
        threadId: "",
        actionId: "",
        messageId: undefined,
        payload: { ok: false, count: 0, label: "", value: null, enabled: false },
      }),
    ).toEqual({
      type: "message_acknowledged",
      threadId: "",
      actionId: "",
      payload: { ok: false, count: 0, label: "", value: null, enabled: false },
    });
  });

  test("maps Convex OpenClaw documents to protocol records", () => {
    const thread = toOpenClawThreadRecord({
      _id: "thread-1",
      sessionKey: "session-1",
      status: "active",
      targetAgent: "default",
      title: "Deploy",
      unreadCount: 1,
      createdAt: 100,
      updatedAt: 200,
      lastMessageAt: 300,
    });
    const message = toOpenClawMessageRecord({
      _id: "message-1",
      threadId: "thread-1",
      direction: "openclaw_to_user",
      authorLabel: "OpenClaw",
      text: "Approve?",
      links: [{ label: "Run", url: "https://cowtail.example.invalid/runs/1" }],
      toolCalls: [
        {
          id: "tool-1",
          name: "inspect",
          args: { target: "rollout" },
          result: "ok",
          status: "complete",
          startedAt: 350,
          completedAt: 375,
          insertedAtContentLength: 0,
          contentSnapshotAtStart: "",
        },
      ],
      deliveryState: "sent",
      createdAt: 400,
      updatedAt: 500,
    });
    const action = toOpenClawActionRecord({
      _id: "action-1",
      threadId: "thread-1",
      messageId: "message-1",
      label: "Approve",
      kind: "approval",
      payload: { decision: "approve" },
      state: "pending",
      resultMetadata: { submittedBy: "openclaw" },
      createdAt: 600,
      updatedAt: 700,
    });

    expect(thread).toEqual({
      id: "thread-1",
      sessionKey: "session-1",
      status: "active",
      targetAgent: "default",
      title: "Deploy",
      unreadCount: 1,
      createdAt: 100,
      updatedAt: 200,
      lastMessageAt: 300,
    });
    expect(message).toEqual({
      id: "message-1",
      threadId: "thread-1",
      direction: "openclaw_to_user",
      authorLabel: "OpenClaw",
      text: "Approve?",
      links: [{ label: "Run", url: "https://cowtail.example.invalid/runs/1" }],
      toolCalls: [
        {
          id: "tool-1",
          name: "inspect",
          args: { target: "rollout" },
          result: "ok",
          status: "complete",
          startedAt: 350,
          completedAt: 375,
          insertedAtContentLength: 0,
          contentSnapshotAtStart: "",
        },
      ],
      deliveryState: "sent",
      createdAt: 400,
      updatedAt: 500,
    });
    expect(action).toEqual({
      id: "action-1",
      threadId: "thread-1",
      messageId: "message-1",
      label: "Approve",
      kind: "approval",
      payload: { decision: "approve" },
      state: "pending",
      resultMetadata: { submittedBy: "openclaw" },
      createdAt: 600,
      updatedAt: 700,
    });
  });

  test("maps OpenClaw messages with embedded actions", () => {
    const message = toOpenClawMessageWithActionsRecord(
      {
        _id: "message-1",
        _creationTime: 1,
        threadId: "thread-1",
        direction: "openclaw_to_user",
        authorLabel: "OpenClaw",
        text: "Approve rollout?",
        links: [],
        deliveryState: "sent",
        createdAt: 1777128000000,
        updatedAt: 1777128000000,
      },
      [
        {
          _id: "action-1",
          _creationTime: 2,
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
    );

    expect(message.actions).toHaveLength(1);
    expect(message.actions[0]?.id).toBe("action-1");
  });

  test("builds action result patches and event payloads", () => {
    expect(
      buildOpenClawActionResultUpdate({
        state: "failed",
        resultMetadata: { reason: "timeout" },
        updatedAt: 900,
      }),
    ).toEqual({
      actionPatch: {
        state: "failed",
        resultMetadata: { reason: "timeout" },
        updatedAt: 900,
      },
      eventPayload: {
        state: "failed",
        resultMetadata: { reason: "timeout" },
      },
    });

    expect(
      buildOpenClawActionResultUpdate({
        state: "submitted",
        updatedAt: 901,
      }),
    ).toEqual({
      actionPatch: {
        state: "submitted",
        updatedAt: 901,
      },
      eventPayload: {
        state: "submitted",
      },
    });
  });

  test("validates OpenClaw tool calls against protocol constraints", () => {
    expect(
      validateOpenClawToolCalls([
        {
          id: "tool-1",
          name: "read_file",
          args: { path: "/tmp/out.log" },
          result: "ok",
          status: "complete",
          startedAt: 10,
          completedAt: 12,
          insertedAtContentLength: 0,
          contentSnapshotAtStart: "",
        },
      ]),
    ).toEqual([
      {
        id: "tool-1",
        name: "read_file",
        args: { path: "/tmp/out.log" },
        result: "ok",
        status: "complete",
        startedAt: 10,
        completedAt: 12,
        insertedAtContentLength: 0,
        contentSnapshotAtStart: "",
      },
    ]);

    expect(() => {
      validateOpenClawToolCalls([{ id: "", name: "read_file", status: "complete" }]);
    }).toThrow();
    expect(() => {
      validateOpenClawToolCalls([{ id: "tool-1", name: "", status: "complete" }]);
    }).toThrow();
    expect(() => {
      validateOpenClawToolCalls([
        { id: "tool-1", name: "read_file", status: "complete", startedAt: 1.5 },
      ]);
    }).toThrow();
    expect(() => {
      validateOpenClawToolCalls([
        {
          id: "tool-1",
          name: "read_file",
          status: "complete",
          insertedAtContentLength: -1,
        },
      ]);
    }).toThrow();
  });

  test("builds message update patches while preserving explicit empty arrays", () => {
    expect(
      buildOpenClawMessageUpdatePatch({
        text: "Updated",
        links: [],
        toolCalls: [],
        deliveryState: "pending",
        updatedAt: 1_777_128_000_000,
      }),
    ).toEqual({
      text: "Updated",
      links: [],
      toolCalls: [],
      deliveryState: "pending",
      updatedAt: 1_777_128_000_000,
    });

    expect(() => {
      buildOpenClawMessageUpdatePatch({
        text: "Updated",
        toolCalls: [{ id: "", name: "bad", status: "complete" }],
        updatedAt: 1_777_128_000_000,
      });
    }).toThrow();
  });

  test("drops OpenClaw replies targeting archived threads", () => {
    expect(
      shouldDropOpenClawReplyForThread({
        status: "archived",
      }),
    ).toBe(true);
    expect(
      shouldDropOpenClawReplyForThread({
        status: "active",
      }),
    ).toBe(false);
    expect(shouldDropOpenClawReplyForThread(null)).toBe(false);
  });

  test("createThreadFromOpenClaw acknowledges and does not write messages for archived threads", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const archivedThread = {
      _id: "thread-archived",
      sessionKey: "session-archived",
      status: "archived",
      targetAgent: "default",
      title: "Archived thread",
      unreadCount: 0,
      createdAt: 100,
      updatedAt: 200,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      existingThread: archivedThread,
    });

    const result = await convexHandler(createThreadFromOpenClaw)(ctx, {
      serviceToken: "realtime-convex-token",
      sessionKey: "session-archived",
      idempotencyKey: "cowtail:reply:archived",
      streamId: "cowtail:stream:archived-create",
      text: "Should be dropped",
      toolCalls: [],
      actions: [],
    });

    expect(result).toEqual({
      threadId: "thread-archived",
      actionIds: [],
      sequence: 1,
    });
    expect(inserts).toContainEqual({
      table: "openclawEvents",
      value: {
        type: "message_acknowledged",
        sequence: 1,
        createdAt: expect.any(Number),
        threadId: "thread-archived",
        payload: {
          streamId: "cowtail:stream:archived-create",
          dropped: true,
          reason: "thread_archived",
        },
      },
    });
    expect(inserts.some((insert) => insert.table === "openclawMessages")).toBe(false);
    expect(patches).toEqual([]);
  });

  test("createThreadFromOpenClaw persists stream correlation on created events", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const { ctx, inserts } = createArchivedDropMutationCtx({});

    const result = await convexHandler(createThreadFromOpenClaw)(ctx, {
      serviceToken: "realtime-convex-token",
      sessionKey: "session-active",
      idempotencyKey: "cowtail:reply:streamed",
      streamId: "cowtail:stream:streamed",
      text: "Streamed reply",
      toolCalls: [],
      actions: [],
    });

    expect(result).toEqual({
      threadId: "openclawThreads-id",
      messageId: "openclawMessages-id",
      actionIds: [],
      sequence: 1,
    });
    expect(inserts).toContainEqual({
      table: "openclawEvents",
      value: {
        type: "message_created",
        sequence: 1,
        createdAt: expect.any(Number),
        threadId: "openclawThreads-id",
        messageId: "openclawMessages-id",
        payload: { streamId: "cowtail:stream:streamed" },
      },
    });
  });

  test("createThreadFromOpenClaw requires streamId in the Convex validator", () => {
    expectRequiredConvexArg(createThreadFromOpenClaw, "streamId");
  });

  test("createThreadFromOpenClaw rejects duplicate idempotency keys with mismatched stream IDs", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const activeThread = {
      _id: "thread-active",
      sessionKey: "session-active",
      status: "active",
      targetAgent: "default",
      title: "Active thread",
      unreadCount: 1,
      createdAt: 100,
      updatedAt: 200,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      existingThread: activeThread,
      idempotencyReceipt: {
        _id: "receipt-create",
        idempotencyKey: "cowtail:reply:message-1",
        commandType: "openclaw_message",
        sessionKey: "session-active",
        threadId: "thread-active",
        messageId: "message-existing",
        sequence: 8,
        commandDigest:
          '{"actions":[],"authorLabel":null,"deliveryState":"sent","links":[],"sessionKey":"session-active","streamId":"cowtail:stream:original-create","text":"Existing reply","title":null,"toolCalls":[]}',
        createdAt: 150,
        updatedAt: 150,
      },
    });

    await expect(
      convexHandler(createThreadFromOpenClaw)(ctx, {
        serviceToken: "realtime-convex-token",
        sessionKey: "session-active",
        idempotencyKey: "cowtail:reply:message-1",
        streamId: "cowtail:stream:mismatched-create",
        text: "Existing reply",
        toolCalls: [],
        actions: [],
      }),
    ).rejects.toThrow(
      "Idempotency key cowtail:reply:message-1 was already used for another command target",
    );
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
  });

  test("createThreadFromOpenClaw acknowledges duplicate idempotency keys without writing messages", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const activeThread = {
      _id: "thread-active",
      sessionKey: "session-active",
      status: "active",
      targetAgent: "default",
      title: "Active thread",
      unreadCount: 1,
      createdAt: 100,
      updatedAt: 200,
    };
    const existingMessage = {
      _id: "message-existing",
      threadId: "thread-active",
      direction: "openclaw_to_user",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      deliveryState: "sent",
      idempotencyKey: "cowtail:reply:message-1",
      createdAt: 150,
      updatedAt: 150,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      existingThread: activeThread,
      idempotentMessage: existingMessage,
      idempotencyReceipt: {
        _id: "receipt-create",
        idempotencyKey: "cowtail:reply:message-1",
        commandType: "openclaw_message",
        sessionKey: "session-active",
        threadId: "thread-active",
        messageId: "message-existing",
        sequence: 8,
        commandDigest:
          '{"actions":[],"authorLabel":null,"deliveryState":"sent","links":[],"sessionKey":"session-active","streamId":"cowtail:stream:duplicate-create","text":"Existing reply","title":null,"toolCalls":[]}',
        createdAt: 150,
        updatedAt: 150,
      },
    });

    const result = await convexHandler(createThreadFromOpenClaw)(ctx, {
      serviceToken: "realtime-convex-token",
      sessionKey: "session-active",
      idempotencyKey: "cowtail:reply:message-1",
      streamId: "cowtail:stream:duplicate-create",
      text: "Existing reply",
      toolCalls: [],
      actions: [],
    });

    expect(result).toEqual({
      ok: true,
      threadId: "thread-active",
      messageId: "message-existing",
      actionIds: [],
      sequence: 1,
    });
    expect(inserts).toEqual([
      {
        table: "openclawState",
        value: {
          key: "openclaw-events",
          nextSequence: 2,
          updatedAt: expect.any(Number),
        },
      },
      {
        table: "openclawEvents",
        value: {
          type: "message_acknowledged",
          sequence: 1,
          createdAt: expect.any(Number),
          threadId: "thread-active",
          messageId: "message-existing",
          payload: {
            streamId: "cowtail:stream:duplicate-create",
            dropped: true,
            duplicate: true,
            reason: "duplicate_idempotency_key",
          },
        },
      },
    ]);
    expect(patches).toEqual([]);
  });

  test("updateMessageFromOpenClaw acknowledges archived drops with top-level message id", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const archivedThread = {
      _id: "thread-archived",
      sessionKey: "session-archived",
      status: "archived",
      targetAgent: "default",
      title: "Archived thread",
      unreadCount: 0,
      createdAt: 100,
      updatedAt: 200,
    };
    const message = {
      _id: "message-archived",
      threadId: "thread-archived",
      direction: "openclaw_to_user",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      deliveryState: "pending",
      createdAt: 150,
      updatedAt: 150,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      existingThread: archivedThread,
      message,
    });

    const result = await convexHandler(updateMessageFromOpenClaw)(ctx, {
      serviceToken: "realtime-convex-token",
      idempotencyKey: "cowtail:reply:message-archived:update:1",
      streamId: "cowtail:stream:archived-update",
      messageId: "message-archived",
      text: "Should be dropped",
      toolCalls: [],
      actions: [],
    });

    expect(result).toEqual({
      threadId: "thread-archived",
      messageId: "message-archived",
      actionIds: [],
      sequence: 1,
    });
    expect(inserts).toContainEqual({
      table: "openclawEvents",
      value: {
        type: "message_acknowledged",
        sequence: 1,
        createdAt: expect.any(Number),
        threadId: "thread-archived",
        messageId: "message-archived",
        payload: {
          streamId: "cowtail:stream:archived-update",
          dropped: true,
          reason: "thread_archived",
        },
      },
    });
    expect(patches).toEqual([]);
  });

  test("updateMessageFromOpenClaw persists stream correlation on updated events", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const thread = {
      _id: "thread-active",
      sessionKey: "session-active",
      status: "active",
      targetAgent: "default",
      title: "Active thread",
      unreadCount: 0,
      createdAt: 100,
      updatedAt: 150,
    };
    const message = {
      _id: "message-existing",
      threadId: "thread-active",
      direction: "openclaw_to_user",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      deliveryState: "pending",
      createdAt: 150,
      updatedAt: 150,
    };
    const { ctx, inserts } = createArchivedDropMutationCtx({
      existingThread: thread,
      message,
    });

    const result = await convexHandler(updateMessageFromOpenClaw)(ctx, {
      serviceToken: "realtime-convex-token",
      idempotencyKey: "cowtail:reply:message-1:update:streamed",
      streamId: "cowtail:stream:update-streamed",
      messageId: "message-existing",
      text: "Updated reply",
      links: [],
      toolCalls: [],
      actions: [],
      deliveryState: "pending",
    });

    expect(result).toEqual({
      threadId: "thread-active",
      messageId: "message-existing",
      actionIds: [],
      sequence: 1,
    });
    expect(inserts).toContainEqual({
      table: "openclawEvents",
      value: {
        type: "message_updated",
        sequence: 1,
        createdAt: expect.any(Number),
        threadId: "thread-active",
        messageId: "message-existing",
        payload: { streamId: "cowtail:stream:update-streamed" },
      },
    });
  });

  test("updateMessageFromOpenClaw requires streamId in the Convex validator", () => {
    expectRequiredConvexArg(updateMessageFromOpenClaw, "streamId");
  });

  test("hydrates replay events with available records", () => {
    expect(
      toOpenClawEventEnvelope({
        event: {
          sequence: 9,
          type: "message_created",
          createdAt: 800,
          threadId: "thread-1",
          messageId: "message-1",
        },
        thread: {
          _id: "thread-1",
          status: "active",
          targetAgent: "default",
          title: "Deploy",
          unreadCount: 1,
          createdAt: 100,
          updatedAt: 200,
        },
        message: {
          _id: "message-1",
          threadId: "thread-1",
          direction: "openclaw_to_user",
          text: "Approve?",
          links: [],
          deliveryState: "sent",
          createdAt: 400,
          updatedAt: 500,
        },
      }),
    ).toEqual({
      sequence: 9,
      type: "message_created",
      createdAt: 800,
      threadId: "thread-1",
      messageId: "message-1",
      thread: {
        id: "thread-1",
        status: "active",
        targetAgent: "default",
        title: "Deploy",
        unreadCount: 1,
        createdAt: 100,
        updatedAt: 200,
      },
      message: {
        id: "message-1",
        threadId: "thread-1",
        direction: "openclaw_to_user",
        text: "Approve?",
        links: [],
        toolCalls: [],
        deliveryState: "sent",
        createdAt: 400,
        updatedAt: 500,
      },
    });
  });

  test("hydrates message events with available actions", () => {
    expect(
      toOpenClawEventEnvelope({
        event: {
          sequence: 10,
          type: "message_created",
          createdAt: 900,
          threadId: "thread-1",
          messageId: "message-1",
        },
        thread: {
          _id: "thread-1",
          status: "active",
          targetAgent: "default",
          title: "Deploy",
          unreadCount: 1,
          createdAt: 100,
          updatedAt: 200,
        },
        message: {
          _id: "message-1",
          threadId: "thread-1",
          direction: "openclaw_to_user",
          text: "Approve?",
          links: [],
          deliveryState: "sent",
          createdAt: 400,
          updatedAt: 500,
        },
        actions: [
          {
            _id: "action-1",
            threadId: "thread-1",
            messageId: "message-1",
            label: "Approve",
            kind: "approval",
            payload: { decision: "approve" },
            state: "pending",
            createdAt: 600,
            updatedAt: 700,
          },
        ],
      }),
    ).toEqual({
      sequence: 10,
      type: "message_created",
      createdAt: 900,
      threadId: "thread-1",
      messageId: "message-1",
      thread: {
        id: "thread-1",
        status: "active",
        targetAgent: "default",
        title: "Deploy",
        unreadCount: 1,
        createdAt: 100,
        updatedAt: 200,
      },
      message: {
        id: "message-1",
        threadId: "thread-1",
        direction: "openclaw_to_user",
        text: "Approve?",
        links: [],
        toolCalls: [],
        deliveryState: "sent",
        createdAt: 400,
        updatedAt: 500,
      },
      actions: [
        {
          id: "action-1",
          threadId: "thread-1",
          messageId: "message-1",
          label: "Approve",
          kind: "approval",
          payload: { decision: "approve" },
          state: "pending",
          createdAt: 600,
          updatedAt: 700,
        },
      ],
    });
  });

  test("createThreadFromOpenClaw rejects idempotency keys from a different session", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const existingMessage = {
      _id: "message-existing",
      threadId: "thread-active",
      direction: "openclaw_to_user",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      deliveryState: "sent",
      idempotencyKey: "cowtail:reply:message-1",
      createdAt: 150,
      updatedAt: 150,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      idempotencyReceipt: {
        _id: "receipt-existing",
        idempotencyKey: "cowtail:reply:message-1",
        commandType: "openclaw_message",
        sessionKey: "session-other",
        threadId: "thread-active",
        messageId: "message-existing",
        sequence: 8,
        createdAt: 150,
        updatedAt: 150,
      },
      idempotentMessage: existingMessage,
    });

    await expect(
      convexHandler(createThreadFromOpenClaw)(ctx, {
        serviceToken: "realtime-convex-token",
        sessionKey: "session-active",
        idempotencyKey: "cowtail:reply:message-1",
        streamId: "cowtail:stream:message-1",
        text: "Existing reply",
        toolCalls: [],
        actions: [],
      }),
    ).rejects.toThrow(
      "Idempotency key cowtail:reply:message-1 was already used for another command target",
    );
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
  });

  test("submitActionFromIos acknowledges duplicate idempotency keys without resubmitting actions", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const action = {
      _id: "action-1",
      threadId: "thread-active",
      messageId: "message-1",
      label: "Approve",
      kind: "decision",
      payload: { decision: "approve" },
      state: "submitted",
      createdAt: 100,
      updatedAt: 150,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      action,
      idempotencyReceipt: {
        _id: "receipt-action",
        idempotencyKey: "ios:action:action-1",
        commandType: "ios_action",
        actionId: "action-1",
        threadId: "thread-active",
        sequence: 8,
        commandDigest: '{"payload":{"decision":"approve"}}',
        createdAt: 150,
        updatedAt: 150,
      },
    });

    const result = await convexHandler(submitActionFromIos)(ctx, {
      serviceToken: "realtime-convex-token",
      idempotencyKey: "ios:action:action-1",
      actionId: "action-1",
      payload: { decision: "approve" },
    });

    expect(result).toEqual({
      ok: true,
      threadId: "thread-active",
      actionId: "action-1",
      actionIds: [],
      sequence: 1,
    });
    expect(patches).toEqual([]);
    expect(inserts.at(-1)).toEqual({
      table: "openclawEvents",
      value: {
        type: "message_acknowledged",
        sequence: 1,
        createdAt: expect.any(Number),
        threadId: "thread-active",
        actionId: "action-1",
        payload: { dropped: true, duplicate: true, reason: "duplicate_idempotency_key" },
      },
    });
  });

  test("updateMessageFromOpenClaw acknowledges duplicate idempotency keys without patching", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const thread = {
      _id: "thread-active",
      sessionKey: "session-active",
      status: "active",
      targetAgent: "default",
      title: "Active thread",
      unreadCount: 0,
      createdAt: 100,
      updatedAt: 150,
    };
    const message = {
      _id: "message-existing",
      threadId: "thread-active",
      direction: "openclaw_to_user",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      deliveryState: "pending",
      createdAt: 150,
      updatedAt: 150,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      existingThread: thread,
      message,
      idempotencyReceipt: {
        _id: "receipt-update",
        idempotencyKey: "cowtail:reply:message-1:update:1",
        commandType: "openclaw_message_update",
        threadId: "thread-active",
        messageId: "message-existing",
        sequence: 8,
        commandDigest:
          '{"actions":[],"deliveryState":"pending","links":[],"messageId":"message-existing","streamId":"cowtail:stream:duplicate-update","text":"Existing reply","toolCalls":[]}',
        createdAt: 150,
        updatedAt: 150,
      },
    });

    const result = await convexHandler(updateMessageFromOpenClaw)(ctx, {
      serviceToken: "realtime-convex-token",
      idempotencyKey: "cowtail:reply:message-1:update:1",
      streamId: "cowtail:stream:duplicate-update",
      messageId: "message-existing",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      actions: [],
      deliveryState: "pending",
    });

    expect(result).toEqual({
      ok: true,
      threadId: "thread-active",
      messageId: "message-existing",
      actionIds: [],
      sequence: 1,
    });
    expect(patches).toEqual([]);
    expect(inserts.at(-1)).toEqual({
      table: "openclawEvents",
      value: {
        type: "message_acknowledged",
        sequence: 1,
        createdAt: expect.any(Number),
        threadId: "thread-active",
        messageId: "message-existing",
        payload: {
          streamId: "cowtail:stream:duplicate-update",
          dropped: true,
          duplicate: true,
          reason: "duplicate_idempotency_key",
        },
      },
    });
  });

  test("updateMessageFromOpenClaw rejects duplicate idempotency keys with mismatched stream IDs", async () => {
    process.env.COWTAIL_REALTIME_CONVEX_TOKEN = "realtime-convex-token";
    const thread = {
      _id: "thread-active",
      sessionKey: "session-active",
      status: "active",
      targetAgent: "default",
      title: "Active thread",
      unreadCount: 0,
      createdAt: 100,
      updatedAt: 150,
    };
    const message = {
      _id: "message-existing",
      threadId: "thread-active",
      direction: "openclaw_to_user",
      text: "Existing reply",
      links: [],
      toolCalls: [],
      deliveryState: "pending",
      createdAt: 150,
      updatedAt: 150,
    };
    const { ctx, inserts, patches } = createArchivedDropMutationCtx({
      existingThread: thread,
      message,
      idempotencyReceipt: {
        _id: "receipt-update",
        idempotencyKey: "cowtail:reply:message-1:update:1",
        commandType: "openclaw_message_update",
        threadId: "thread-active",
        messageId: "message-existing",
        sequence: 8,
        commandDigest:
          '{"actions":[],"deliveryState":"pending","links":[],"messageId":"message-existing","streamId":"cowtail:stream:original-update","text":"Existing reply","toolCalls":[]}',
        createdAt: 150,
        updatedAt: 150,
      },
    });

    await expect(
      convexHandler(updateMessageFromOpenClaw)(ctx, {
        serviceToken: "realtime-convex-token",
        idempotencyKey: "cowtail:reply:message-1:update:1",
        streamId: "cowtail:stream:mismatched-update",
        messageId: "message-existing",
        text: "Existing reply",
        links: [],
        toolCalls: [],
        actions: [],
        deliveryState: "pending",
      }),
    ).rejects.toThrow(
      "Idempotency key cowtail:reply:message-1:update:1 was already used for another command target",
    );
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
  });
});
