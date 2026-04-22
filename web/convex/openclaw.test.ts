import { describe, expect, test } from "bun:test";

import {
  buildOpenClawEventPayload,
  normalizeOpenClawTitle,
  sortOpenClawMessagesAscending,
} from "./openclawModel";

describe("OpenClaw Convex model helpers", () => {
  test("normalizes blank titles to Main", () => {
    expect(normalizeOpenClawTitle("")).toBe("Main");
    expect(normalizeOpenClawTitle("  deploy check  ")).toBe("deploy check");
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
        type: "message_updated",
        threadId: "",
        actionId: "",
        messageId: undefined,
        payload: { ok: false, count: 0, label: "", value: null, enabled: false },
      }),
    ).toEqual({
      type: "message_updated",
      threadId: "",
      actionId: "",
      payload: { ok: false, count: 0, label: "", value: null, enabled: false },
    });
  });
});
