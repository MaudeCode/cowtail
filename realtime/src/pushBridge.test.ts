import { describe, expect, test } from "bun:test";
import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import { CowtailHttpPushBridge } from "./pushBridge";

function createMessageEvent(): OpenClawEventEnvelope {
  return {
    sequence: 7,
    type: "message_created",
    createdAt: 100,
    threadId: "thread-1",
    messageId: "message-1",
    thread: {
      id: "thread-1",
      status: "active",
      targetAgent: "default",
      title: "Deploy",
      unreadCount: 1,
      createdAt: 100,
      updatedAt: 100,
      lastMessageAt: 100,
    },
    message: {
      id: "message-1",
      threadId: "thread-1",
      direction: "openclaw_to_user",
      text: "Approve the deploy?",
      links: [],
      deliveryState: "sent",
      createdAt: 100,
      updatedAt: 100,
    },
  };
}

describe("CowtailHttpPushBridge", () => {
  test("sends OpenClaw message notifications to the Cowtail push API", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Response.json({
        ok: true,
        userId: "owner-user-id",
        sent: 1,
        failed: 0,
        results: [],
      });
    };
    const event = createMessageEvent();

    const bridge = new CowtailHttpPushBridge({
      httpBaseUrl: "https://cowtail.example.invalid",
      bearerToken: "push-token",
      ownerUserId: "owner-user-id",
      fetchImpl,
    });

    const result = await bridge.sendOpenClawMessageNotification(event);

    expect(requests.length).toBe(1);
    expect(requests[0]?.url).toBe("https://cowtail.example.invalid/api/push/send");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer push-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      userId: "owner-user-id",
      title: "OpenClaw: Deploy",
      body: "Approve the deploy?",
      data: { kind: "openclaw", threadId: "thread-1", messageId: "message-1" },
    });
    expect(result.ok).toBe(true);
  });

  test("returns failure when the Cowtail push request rejects", async () => {
    const bridge = new CowtailHttpPushBridge({
      httpBaseUrl: "https://cowtail.example.invalid",
      bearerToken: "push-token",
      ownerUserId: "owner-user-id",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    expect(await bridge.sendOpenClawMessageNotification(createMessageEvent())).toEqual({
      ok: false,
      sent: 0,
      failed: 1,
    });
  });

  test("returns failure when the Cowtail push API returns malformed JSON", async () => {
    const bridge = new CowtailHttpPushBridge({
      httpBaseUrl: "https://cowtail.example.invalid",
      bearerToken: "push-token",
      ownerUserId: "owner-user-id",
      fetchImpl: async () => Response.json({ ok: "yes", sent: "1", failed: 0 }),
    });

    expect(await bridge.sendOpenClawMessageNotification(createMessageEvent())).toEqual({
      ok: false,
      sent: 0,
      failed: 1,
    });
  });

  test("returns failure without calling fetch when message text is invalid", async () => {
    let fetchCalls = 0;
    const bridge = new CowtailHttpPushBridge({
      httpBaseUrl: "https://cowtail.example.invalid",
      bearerToken: "push-token",
      ownerUserId: "owner-user-id",
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({
          ok: true,
          userId: "owner-user-id",
          sent: 1,
          failed: 0,
          results: [],
        });
      },
    });
    const event = createMessageEvent();
    delete (event.message as unknown as { text?: string }).text;

    expect(await bridge.sendOpenClawMessageNotification(event)).toEqual({
      ok: false,
      sent: 0,
      failed: 1,
    });
    expect(fetchCalls).toBe(0);
  });
});
