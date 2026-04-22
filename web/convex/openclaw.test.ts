import { describe, expect, test } from "bun:test";

import {
  buildOpenClawEventPayload,
  applyOpenClawThreadTitlePatch,
  normalizeOpenClawTitle,
  validateOpenClawAfterSequence,
  validateOpenClawLimit,
  sortOpenClawMessagesAscending,
} from "./openclawModel";

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
});
