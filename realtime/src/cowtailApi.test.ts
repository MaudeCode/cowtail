import { describe, expect, test } from "bun:test";
import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import { ConvexCowtailRealtimeApi, type ConvexLike } from "./cowtailApi";

type ConvexApiRefs = {
  authSessions: { verifySessionTokenHash: unknown };
  openclaw: {
    createThreadFromOpenClaw: unknown;
    replayEvents: unknown;
  };
};

const generatedConvexApiModule = "../../web/convex/_generated/api.js";
const { api: convexApi } = (await import(generatedConvexApiModule)) as { api: ConvexApiRefs };

function createReplayEvent(sequence: number): OpenClawEventEnvelope {
  return {
    sequence,
    type: "message_created",
    createdAt: 100,
    threadId: "thread-1",
    messageId: "message-1",
    thread: {
      id: "thread-1",
      sessionKey: "session-1",
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

describe("ConvexCowtailRealtimeApi", () => {
  test("verifyAppSessionToken hashes the token before calling Convex", async () => {
    const mutations: Array<{ reference: unknown; args: unknown }> = [];
    const convex: ConvexLike = {
      query: async () => {
        throw new Error("query should not be called");
      },
      mutation: async (reference, args) => {
        mutations.push({ reference, args });
        return { ok: true, userId: "owner-user-id", expiresAt: 200 };
      },
    };
    const api = new ConvexCowtailRealtimeApi(convex);

    const result = await api.verifyAppSessionToken("app-session-token");

    expect(result).toEqual({ ok: true, userId: "owner-user-id" });
    expect(mutations).toEqual([
      {
        reference: convexApi.authSessions.verifySessionTokenHash,
        args: {
          tokenHash: "c939bf0820e59e806b6cd3b59499b355da0a6a9c7332d40dc7bf15ff1795d16f",
        },
      },
    ]);
    expect(JSON.stringify(mutations[0]?.args).includes("app-session-token")).toBe(false);
  });

  test("createOpenClawMessage returns the hydrated replay event for the created sequence", async () => {
    const replayEvent = createReplayEvent(7);
    const mutations: Array<{ reference: unknown; args: unknown }> = [];
    const queries: Array<{ reference: unknown; args: unknown }> = [];
    const convex: ConvexLike = {
      query: async (reference, args) => {
        queries.push({ reference, args });
        return [replayEvent];
      },
      mutation: async (reference, args) => {
        mutations.push({ reference, args });
        return { threadId: "thread-1", messageId: "message-1", actionIds: [], sequence: 7 };
      },
    };
    const api = new ConvexCowtailRealtimeApi(convex);

    const event = await api.createOpenClawMessage({
      type: "openclaw_message",
      requestId: "request-1",
      sessionKey: "session-1",
      title: "Deploy",
      text: "Approve the deploy?",
      links: [],
      actions: [],
    });

    expect(mutations).toEqual([
      {
        reference: convexApi.openclaw.createThreadFromOpenClaw,
        args: {
          sessionKey: "session-1",
          title: "Deploy",
          text: "Approve the deploy?",
          links: [],
          actions: [],
        },
      },
    ]);
    expect(queries).toEqual([
      {
        reference: convexApi.openclaw.replayEvents,
        args: { afterSequence: 6, limit: 1 },
      },
    ]);
    expect(event).toEqual(replayEvent);
    expect(event.sequence).toBe(7);
  });

  test("createOpenClawMessage throws when replay returns the wrong sequence", async () => {
    const api = new ConvexCowtailRealtimeApi({
      query: async () => [createReplayEvent(8)],
      mutation: async () => {
        return { threadId: "thread-1", messageId: "message-1", actionIds: [], sequence: 7 };
      },
    });

    let thrown: unknown;
    try {
      await api.createOpenClawMessage({
        type: "openclaw_message",
        requestId: "request-1",
        sessionKey: "session-1",
        title: "Deploy",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toBe(
      "Convex replay query returned sequence 8 for mutation sequence 7",
    );
  });

  test("createOpenClawMessage throws when replay returns no event", async () => {
    const api = new ConvexCowtailRealtimeApi({
      query: async () => [],
      mutation: async () => {
        return { threadId: "thread-1", messageId: "message-1", actionIds: [], sequence: 7 };
      },
    });

    let thrown: unknown;
    try {
      await api.createOpenClawMessage({
        type: "openclaw_message",
        requestId: "request-1",
        sessionKey: "session-1",
        title: "Deploy",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toBe(
      "Convex replay query did not return an event for mutation sequence 7",
    );
  });
});
