import { afterEach, describe, expect, test } from "bun:test";

import {
  buildOpenClawActionResultUpdate,
  buildOpenClawEventPayload,
  applyOpenClawThreadTitlePatch,
  normalizeOpenClawTitle,
  toOpenClawActionRecord,
  toOpenClawEventEnvelope,
  toOpenClawMessageWithActionsRecord,
  toOpenClawMessageRecord,
  toOpenClawThreadRecord,
  validateOpenClawAfterSequence,
  validateOpenClawLimit,
  sortOpenClawMessagesAscending,
} from "./openclawModel";
import { parseOpenClawListLimit, requireOpenClawOwner } from "./http";

const originalOpenClawOwnerUserId = process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;

afterEach(() => {
  if (originalOpenClawOwnerUserId === undefined) {
    delete process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;
    return;
  }

  process.env.COWTAIL_OPENCLAW_OWNER_USER_ID = originalOpenClawOwnerUserId;
});

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
});
