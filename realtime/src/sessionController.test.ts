import { describe, expect, test } from "bun:test";
import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import type { CowtailRealtimeApi, CowtailRealtimeApiEventResult } from "./cowtailApi";
import { RealtimeConnectionRegistry } from "./connectionRegistry";
import type { OpenClawPushBridge, PushBridgeResult } from "./pushBridge";
import { OpenClawSessionController, shouldReplayToClient } from "./sessionController";

class FakeSocket {
  public readyState = 1;
  public readonly sentMessages: string[] = [];
  public readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeCalls.push({ code, reason });
  }
}

class FakeCowtailRealtimeApi implements CowtailRealtimeApi {
  public verifiedSessionTokens: string[] = [];
  public validatedSessionIds: string[] = [];
  public readonly replayQueries: Array<number | undefined> = [];
  public replayEventsResult: OpenClawEventEnvelope[] = [];
  public rejectReplayEvents = false;
  public rejectOpenClawMessage = false;
  public rejectVerifyAppSessionToken = false;
  public appSessionVerificationOk = true;
  public appSessionValidationOk = true;
  public holdOpenClawMessages = false;
  public duplicateOpenClawMessage = false;
  public duplicateIosReply = false;
  public readonly heldOpenClawMessages: Array<{
    command: Parameters<CowtailRealtimeApi["createOpenClawMessage"]>[0];
    resolve: (event: CowtailRealtimeApiEventResult) => void;
  }> = [];
  public readonly openClawMessageUpdates: Parameters<
    CowtailRealtimeApi["updateOpenClawMessage"]
  >[0][] = [];
  public readonly openClawMessages: Parameters<CowtailRealtimeApi["createOpenClawMessage"]>[0][] =
    [];
  public readonly iosThreads: Parameters<CowtailRealtimeApi["createIosThread"]>[0][] = [];
  public readonly iosReplies: Parameters<CowtailRealtimeApi["createIosReply"]>[0][] = [];
  public readonly renamedThreads: Parameters<CowtailRealtimeApi["renameIosThread"]>[0][] = [];
  public readonly deletedThreads: Parameters<CowtailRealtimeApi["deleteIosThread"]>[0][] = [];
  public appSessionUserId = "owner-user-id";
  public appSessionSessionId = "session-1";
  public appSessionExpiresAt = Date.now() + 60_000;
  public openClawMessageEvent = createOpenClawMessageEvent(7);
  public openClawMessageUpdateEvent = createOpenClawMessageUpdateEvent(12);
  public iosReplyEvent = createIosReplyEvent(9);

  async verifyAppSessionToken(token: string) {
    this.verifiedSessionTokens.push(token);
    if (this.rejectVerifyAppSessionToken) {
      throw new Error("verification unavailable");
    }
    if (!this.appSessionVerificationOk) {
      return { ok: false as const };
    }
    return {
      ok: true as const,
      userId: this.appSessionUserId,
      sessionId: this.appSessionSessionId,
      expiresAt: this.appSessionExpiresAt,
    };
  }

  async validateAppSession(sessionId: string) {
    this.validatedSessionIds.push(sessionId);
    if (!this.appSessionValidationOk) {
      return { ok: false as const };
    }
    return {
      ok: true as const,
      userId: this.appSessionUserId,
      expiresAt: this.appSessionExpiresAt,
    };
  }

  async replayEvents(afterSequence?: number): Promise<OpenClawEventEnvelope[]> {
    this.replayQueries.push(afterSequence);
    if (this.rejectReplayEvents) {
      throw new Error("replay unavailable");
    }
    return this.replayEventsResult;
  }

  async createOpenClawMessage(command: Parameters<CowtailRealtimeApi["createOpenClawMessage"]>[0]) {
    this.openClawMessages.push(command);
    if (this.rejectOpenClawMessage) {
      throw new Error("mutation failed");
    }
    if (this.holdOpenClawMessages) {
      return await new Promise<CowtailRealtimeApiEventResult>((resolve) => {
        this.heldOpenClawMessages.push({ command, resolve });
      });
    }
    const event = withPersistedStreamId(this.openClawMessageEvent, command.streamId);
    return this.duplicateOpenClawMessage ? { event, duplicate: true as const } : event;
  }

  async updateOpenClawMessage(command: Parameters<CowtailRealtimeApi["updateOpenClawMessage"]>[0]) {
    this.openClawMessageUpdates.push(command);
    return withPersistedStreamId(this.openClawMessageUpdateEvent, command.streamId);
  }

  async createIosThread(command: Parameters<CowtailRealtimeApi["createIosThread"]>[0]) {
    this.iosThreads.push(command);
    return createEvent(3, "thread_created", {
      threadId: "thread-1",
      messageId: "message-ios-thread",
      thread: {
        id: "thread-1",
        status: "pending",
        targetAgent: "default",
        title: command.title ?? "Main",
        unreadCount: 0,
        createdAt: 100,
        updatedAt: 100,
        lastMessageAt: 100,
      },
      message: {
        id: "message-ios-thread",
        threadId: "thread-1",
        direction: "user_to_openclaw",
        text: command.text,
        links: [],
        toolCalls: [],
        deliveryState: "sent",
        createdAt: 100,
        updatedAt: 100,
      },
      payload: { text: command.text },
    });
  }

  async createIosReply(command: Parameters<CowtailRealtimeApi["createIosReply"]>[0]) {
    this.iosReplies.push(command);
    return this.duplicateIosReply
      ? { event: this.iosReplyEvent, duplicate: true as const }
      : this.iosReplyEvent;
  }

  async submitIosAction(command: Parameters<CowtailRealtimeApi["submitIosAction"]>[0]) {
    return createEvent(4, "action_submitted", {
      actionId: command.actionId,
      payload: command.payload,
    });
  }

  async markThreadRead(command: Parameters<CowtailRealtimeApi["markThreadRead"]>[0]) {
    return createEvent(5, "thread_updated", { threadId: command.threadId });
  }

  async renameIosThread(command: Parameters<CowtailRealtimeApi["renameIosThread"]>[0]) {
    this.renamedThreads.push(command);
    return createEvent(10, "thread_updated", {
      threadId: command.threadId,
      thread: {
        id: command.threadId,
        sessionKey: "session-1",
        status: "active",
        targetAgent: "default",
        title: command.title,
        unreadCount: 0,
        createdAt: 100,
        updatedAt: 200,
      },
    });
  }

  async deleteIosThread(command: Parameters<CowtailRealtimeApi["deleteIosThread"]>[0]) {
    this.deletedThreads.push(command);
    return createEvent(11, "thread_updated", {
      threadId: command.threadId,
      thread: {
        id: command.threadId,
        sessionKey: "session-1",
        status: "archived",
        targetAgent: "default",
        title: "Deleted thread",
        unreadCount: 0,
        createdAt: 100,
        updatedAt: 200,
      },
      payload: { deleted: true },
    });
  }

  async bindThreadSession(command: Parameters<CowtailRealtimeApi["bindThreadSession"]>[0]) {
    return createEvent(6, "session_bound", {
      threadId: command.threadId,
      payload: { sessionKey: command.sessionKey },
    });
  }

  async recordActionResult(command: Parameters<CowtailRealtimeApi["recordActionResult"]>[0]) {
    return createEvent(8, "action_result", {
      actionId: command.actionId,
      payload: command.resultMetadata ?? {},
    });
  }
}

class FakePushBridge implements OpenClawPushBridge {
  public readonly notifications: OpenClawEventEnvelope[] = [];
  public rejectNotifications = false;
  public holdNotifications = false;
  public releaseHeldNotification: (() => void) | undefined;

  async sendOpenClawMessageNotification(event: OpenClawEventEnvelope): Promise<PushBridgeResult> {
    this.notifications.push(event);
    if (this.holdNotifications) {
      await new Promise<void>((resolve) => {
        this.releaseHeldNotification = resolve;
      });
    }
    if (this.rejectNotifications) {
      throw new Error("push failed");
    }
    return { ok: true, sent: 1, failed: 0 };
  }
}

function createController() {
  const api = new FakeCowtailRealtimeApi();
  const registry = new RealtimeConnectionRegistry();
  const pushBridge = new FakePushBridge();
  const controller = new OpenClawSessionController({
    bridgeToken: "bridge-token",
    ownerUserId: "owner-user-id",
    api,
    registry,
    pushBridge,
  });

  return { api, controller, pushBridge, registry };
}

function sent(socket: FakeSocket): unknown[] {
  return socket.sentMessages.map((message) => JSON.parse(message));
}

function withPersistedStreamId(
  event: OpenClawEventEnvelope,
  streamId: string | undefined,
): OpenClawEventEnvelope {
  if (streamId === undefined) {
    return event;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      streamId,
    },
  };
}

function createEvent(
  sequence: number,
  type: OpenClawEventEnvelope["type"],
  extra: Partial<OpenClawEventEnvelope> = {},
): OpenClawEventEnvelope {
  return {
    sequence,
    type,
    createdAt: 100 + sequence,
    ...extra,
  };
}

function createOpenClawMessageEvent(sequence: number): OpenClawEventEnvelope {
  return createEvent(sequence, "message_created", {
    threadId: "thread-openclaw",
    messageId: "message-openclaw",
    message: {
      id: "message-openclaw",
      threadId: "thread-openclaw",
      direction: "openclaw_to_user",
      text: "Approve the deploy?",
      links: [],
      toolCalls: [],
      deliveryState: "sent",
      createdAt: 100,
      updatedAt: 100,
    },
  });
}

function createOpenClawMessageUpdateEvent(sequence: number): OpenClawEventEnvelope {
  return createEvent(sequence, "message_updated", {
    threadId: "thread-openclaw",
    messageId: "message-openclaw",
    message: {
      id: "message-openclaw",
      threadId: "thread-openclaw",
      direction: "openclaw_to_user",
      text: "Still checking...",
      links: [],
      toolCalls: [],
      deliveryState: "pending",
      createdAt: 100,
      updatedAt: 120,
    },
  });
}

function createIosReplyEvent(sequence: number): OpenClawEventEnvelope {
  return createEvent(sequence, "reply_created", {
    threadId: "thread-1",
    messageId: "message-ios",
    message: {
      id: "message-ios",
      threadId: "thread-1",
      direction: "user_to_openclaw",
      text: "Ship it",
      links: [],
      toolCalls: [],
      deliveryState: "sent",
      createdAt: 100,
      updatedAt: 100,
    },
  });
}

async function authenticatePlugin(
  controller: OpenClawSessionController,
  socket: FakeSocket,
  connectionId = "plugin-1",
) {
  controller.attach(connectionId, socket);
  await controller.handleRawMessage(
    connectionId,
    JSON.stringify({
      protocolVersion: 1,
      clientKind: "openclaw_plugin",
      token: "bridge-token",
    }),
  );
}

async function authenticateIos(
  controller: OpenClawSessionController,
  socket: FakeSocket,
  connectionId = "ios-1",
) {
  controller.attach(connectionId, socket);
  await controller.handleRawMessage(
    connectionId,
    JSON.stringify({
      protocolVersion: 1,
      clientKind: "ios",
      appSessionToken: "app-session-token",
    }),
  );
}

describe("OpenClawSessionController", () => {
  test("invalid JSON sends realtime_error and keeps the socket attached for a later hello", async () => {
    const { controller, registry } = createController();
    const socket = new FakeSocket();
    controller.attach("plugin-1", socket);

    await controller.handleRawMessage("plugin-1", "{");
    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "openclaw_plugin",
        token: "bridge-token",
      }),
    );

    expect(socket.closeCalls).toEqual([]);
    expect(registry.getClient("plugin-1")).toEqual({ kind: "openclaw_plugin" });
    expect(sent(socket)).toEqual([
      { type: "realtime_error", error: "invalid_json" },
      {
        sequence: 0,
        type: "hello_acknowledged",
        createdAt: 0,
        payload: { clientKind: "openclaw_plugin" },
      },
    ]);
  });

  test("malformed hello sends realtime_error, closes with 1008, and detaches", async () => {
    const { controller, registry } = createController();
    const socket = new FakeSocket();
    controller.attach("plugin-1", socket);

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "openclaw_plugin",
      }),
    );

    expect(sent(socket)).toEqual([{ type: "realtime_error", error: "invalid_hello" }]);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "invalid_hello" }]);
    expect(registry.getClient("plugin-1")).toBe(undefined);

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "openclaw_plugin",
        token: "bridge-token",
      }),
    );
    expect(sent(socket)).toEqual([{ type: "realtime_error", error: "invalid_hello" }]);
  });

  test("unauthorized iOS hello sends realtime_error, closes with 1008, and detaches", async () => {
    const { api, controller, registry } = createController();
    api.appSessionVerificationOk = false;
    const socket = new FakeSocket();
    controller.attach("ios-1", socket);

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "ios",
        appSessionToken: "bad-session-token",
      }),
    );

    expect(sent(socket)).toEqual([{ type: "realtime_error", error: "unauthorized" }]);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
  });

  test("non-owner iOS hello sends unauthorized realtime_error, closes with 1008, and is not added to registry", async () => {
    const { api, controller, registry } = createController();
    api.appSessionUserId = "other-user-id";
    const socket = new FakeSocket();
    controller.attach("ios-1", socket);

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "ios",
        appSessionToken: "other-user-session-token",
      }),
    );

    expect(sent(socket)).toEqual([{ type: "realtime_error", error: "unauthorized" }]);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
  });

  test("auth verifier rejection is contained, sends realtime_error, closes with 1008, and detaches", async () => {
    const { api, controller, registry } = createController();
    api.rejectVerifyAppSessionToken = true;
    const socket = new FakeSocket();
    controller.attach("ios-1", socket);

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "ios",
        appSessionToken: "session-token",
      }),
    );

    expect(sent(socket)).toEqual([{ type: "realtime_error", error: "auth_failed" }]);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "auth_failed" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
  });

  test("authenticates an OpenClaw plugin hello and sends hello_acknowledged", async () => {
    const { controller, registry } = createController();
    const socket = new FakeSocket();

    await authenticatePlugin(controller, socket);

    expect(registry.getClient("plugin-1")).toEqual({ kind: "openclaw_plugin" });
    expect(sent(socket)).toEqual([
      {
        sequence: 0,
        type: "hello_acknowledged",
        createdAt: 0,
        payload: { clientKind: "openclaw_plugin" },
      },
    ]);
  });

  test("replays all events to iOS and only selected event types to OpenClaw plugins", async () => {
    const { api, controller } = createController();
    api.replayEventsResult = [
      createEvent(2, "thread_created"),
      createEvent(3, "thread_updated"),
      createEvent(4, "message_created", { payload: { streamId: "cowtail:stream:replay-4" } }),
      createEvent(5, "reply_created"),
      createEvent(6, "action_submitted"),
      createEvent(7, "action_result"),
    ];
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    controller.attach("plugin-1", pluginSocket);
    controller.attach("ios-1", iosSocket);

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "openclaw_plugin",
        token: "bridge-token",
        lastSeenSequence: 1,
      }),
    );
    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "ios",
        appSessionToken: "app-session-token",
        lastSeenSequence: 1,
      }),
    );

    expect(api.replayQueries).toEqual([1, 1]);
    expect(sent(pluginSocket).slice(1)).toEqual([
      createEvent(2, "thread_created"),
      createEvent(5, "reply_created"),
      createEvent(6, "action_submitted"),
    ]);
    expect(sent(iosSocket).slice(1)).toEqual(api.replayEventsResult);
  });

  test("does not replay archived thread events to OpenClaw plugins", () => {
    expect(
      shouldReplayToClient(
        { kind: "openclaw_plugin", lastSeenSequence: 1 },
        createEvent(2, "reply_created", {
          threadId: "thread-deleted",
          thread: {
            id: "thread-deleted",
            sessionKey: "session-deleted",
            status: "archived",
            targetAgent: "default",
            title: "Deleted thread",
            unreadCount: 0,
            createdAt: 100,
            updatedAt: 200,
          },
        }),
      ),
    ).toBe(false);
  });

  test("replay rejection is contained and sends unscoped realtime_error after hello ack", async () => {
    const { api, controller, registry } = createController();
    api.rejectReplayEvents = true;
    const socket = new FakeSocket();
    controller.attach("plugin-1", socket);

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        protocolVersion: 1,
        clientKind: "openclaw_plugin",
        token: "bridge-token",
        lastSeenSequence: 1,
      }),
    );

    expect(registry.getClient("plugin-1")).toEqual({
      kind: "openclaw_plugin",
      lastSeenSequence: 1,
    });
    expect(sent(socket)).toEqual([
      {
        sequence: 0,
        type: "hello_acknowledged",
        createdAt: 0,
        payload: { clientKind: "openclaw_plugin" },
      },
      { type: "realtime_error", error: "replay_failed" },
    ]);
    expect(socket.closeCalls).toEqual([]);
  });

  test("invalid authenticated command sends realtime_error", async () => {
    const { controller } = createController();
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-1",
      }),
    );

    expect(sent(socket)).toEqual([
      { type: "realtime_error", requestId: "request-1", error: "invalid_command" },
    ]);
    expect(socket.closeCalls).toEqual([]);
  });

  test("command-not-allowed sends request-scoped realtime_error", async () => {
    const { controller } = createController();
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "ios_reply",
        requestId: "request-2",
        idempotencyKey: "ios:reply:request-2",
        threadId: "thread-1",
        text: "Ship it",
      }),
    );

    expect(sent(socket)).toEqual([
      { type: "realtime_error", requestId: "request-2", error: "command_not_allowed" },
    ]);
    expect(socket.closeCalls).toEqual([]);
  });

  test("creates OpenClaw messages from authenticated plugins, broadcasts to iOS, pushes when no iOS sockets are connected, and acks the plugin", async () => {
    const { api, controller, pushBridge } = createController();
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-1",
        idempotencyKey: "cowtail:reply:request-1",
        streamId: "cowtail:stream:request-1",
        sessionKey: "session-1",
        title: "Deploy",
        text: "Approve the deploy?",
        links: [],
        toolCalls: [],
        actions: [],
      }),
    );

    expect(api.openClawMessages).toEqual([
      {
        type: "openclaw_message",
        requestId: "request-1",
        idempotencyKey: "cowtail:reply:request-1",
        streamId: "cowtail:stream:request-1",
        sessionKey: "session-1",
        title: "Deploy",
        text: "Approve the deploy?",
        links: [],
        toolCalls: [],
        actions: [],
      },
    ]);
    expect(pushBridge.notifications).toEqual([
      withPersistedStreamId(api.openClawMessageEvent, "cowtail:stream:request-1"),
    ]);
    expect(sent(socket)).toEqual([
      {
        type: "ack",
        requestId: "request-1",
        sequence: 7,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("duplicate OpenClaw messages ack original sequence without broadcast or push", async () => {
    const { api, controller, pushBridge } = createController();
    api.duplicateOpenClawMessage = true;
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-duplicate",
        idempotencyKey: "cowtail:reply:request-duplicate",
        streamId: "cowtail:stream:request-duplicate",
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        toolCalls: [],
        actions: [],
      }),
    );

    expect(sent(iosSocket)).toEqual([]);
    expect(pushBridge.notifications).toEqual([]);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-duplicate",
        sequence: 7,
        payload: {
          threadId: "thread-openclaw",
          messageId: "message-openclaw",
          duplicate: true,
          reason: "duplicate_idempotency_key",
        },
      },
    ]);
  });

  test("does not push when an iOS socket receives an OpenClaw message and sends iOS event before plugin ack", async () => {
    const { api, controller, pushBridge } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-3",
        idempotencyKey: "cowtail:reply:request-3",
        streamId: "cowtail:stream:request-3",
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      {
        ...api.openClawMessageEvent,
        payload: { streamId: "cowtail:stream:request-3" },
      },
    ]);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-3",
        sequence: 7,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("acks dropped archived OpenClaw messages with drop metadata", async () => {
    const { api, controller, pushBridge } = createController();
    api.openClawMessageEvent = createEvent(15, "message_acknowledged", {
      threadId: "thread-archived",
      payload: { dropped: true, reason: "thread_archived" },
    });
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-dropped-create",
        idempotencyKey: "cowtail:reply:request-dropped-create",
        streamId: "cowtail:stream:request-dropped-create",
        sessionKey: "session-archived",
        text: "This should be dropped",
        links: [],
        actions: [],
      }),
    );

    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      {
        ...api.openClawMessageEvent,
        payload: {
          dropped: true,
          reason: "thread_archived",
          streamId: "cowtail:stream:request-dropped-create",
        },
      },
    ]);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-dropped-create",
        sequence: 15,
        payload: {
          threadId: "thread-archived",
          dropped: true,
          reason: "thread_archived",
        },
      },
    ]);
  });

  test("does not push archived OpenClaw message envelopes", async () => {
    const { api, controller, pushBridge } = createController();
    api.openClawMessageEvent = createOpenClawMessageEvent(16);
    api.openClawMessageEvent.thread = {
      id: "thread-openclaw",
      sessionKey: "session-archived",
      status: "archived",
      targetAgent: "default",
      title: "Deleted thread",
      unreadCount: 0,
      createdAt: 100,
      updatedAt: 160,
      lastMessageAt: 160,
    };
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-archived-envelope",
        idempotencyKey: "cowtail:reply:request-archived-envelope",
        streamId: "cowtail:stream:request-archived-envelope",
        sessionKey: "session-archived",
        text: "Old reply from a deleted thread",
        links: [],
        actions: [],
      }),
    );

    expect(pushBridge.notifications).toEqual([]);
    expect(sent(socket)).toEqual([
      {
        type: "ack",
        requestId: "request-archived-envelope",
        sequence: 16,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("updates OpenClaw messages from authenticated plugins and broadcasts the streamed update to iOS", async () => {
    const { api, controller, pushBridge } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_update",
        requestId: "request-update-1",
        idempotencyKey: "cowtail:update:message-openclaw:pending",
        streamId: "cowtail:stream:message-openclaw",
        messageId: "message-openclaw",
        text: "Still checking...",
        links: [],
        deliveryState: "pending",
      }),
    );

    const updateEvent = createOpenClawMessageUpdateEvent(12);
    expect(api.openClawMessageUpdates).toEqual([
      {
        type: "openclaw_message_update",
        requestId: "request-update-1",
        idempotencyKey: "cowtail:update:message-openclaw:pending",
        streamId: "cowtail:stream:message-openclaw",
        messageId: "message-openclaw",
        text: "Still checking...",
        links: [],
        deliveryState: "pending",
      },
    ]);
    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      {
        ...updateEvent,
        payload: { streamId: "cowtail:stream:message-openclaw" },
      },
    ]);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-update-1",
        sequence: 12,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("broadcasts OpenClaw stream snapshots from plugins to iOS only without persistence or push fallback", async () => {
    const { api, controller, pushBridge } = createController();
    const pluginSocket = new FakeSocket();
    const pluginObserverSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticatePlugin(controller, pluginObserverSocket, "plugin-2");
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    pluginObserverSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-1",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text",
        links: [],
        toolCalls: [],
        snapshotSequence: 1,
        isFinal: false,
        updatedAt: 1777939200000,
      }),
    );

    const snapshot = {
      type: "openclaw_message_stream_snapshot",
      streamId: "stream-message-1",
      sessionKey: "session-1",
      threadId: "thread-1",
      text: "Partial text",
      links: [],
      toolCalls: [],
      snapshotSequence: 1,
      isFinal: false,
      updatedAt: 1777939200000,
    };
    expect(api.openClawMessages).toEqual([]);
    expect(api.openClawMessageUpdates).toEqual([]);
    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([snapshot]);
    expect(sent(pluginObserverSocket)).toEqual([]);
    expect(sent(pluginSocket)).toEqual([{ type: "ack", requestId: "stream-request-1" }]);
  });

  test("skips cached-expired iOS sockets for stream snapshots before validating sessions", async () => {
    const { api, controller, registry } = createController();
    api.appSessionExpiresAt = 0;
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-expired",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text",
        links: [],
        toolCalls: [],
        snapshotSequence: 1,
        isFinal: false,
        updatedAt: 1777939200000,
      }),
    );

    expect(api.validatedSessionIds).toEqual([]);
    expect(sent(iosSocket)).toEqual([{ type: "realtime_error", error: "unauthorized" }]);
    expect(iosSocket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
    expect(sent(pluginSocket)).toEqual([{ type: "ack", requestId: "stream-request-expired" }]);
  });

  test("rejects revoked but unexpired iOS sockets before stream snapshot delivery", async () => {
    const { api, controller, registry } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    api.appSessionValidationOk = false;
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-revoked",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text",
        links: [],
        toolCalls: [],
        snapshotSequence: 1,
        isFinal: false,
        updatedAt: 1777939200000,
      }),
    );

    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(sent(iosSocket)).toEqual([{ type: "realtime_error", error: "unauthorized" }]);
    expect(iosSocket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
    expect(sent(pluginSocket)).toEqual([{ type: "ack", requestId: "stream-request-revoked" }]);
  });

  test("reuses recent iOS session validation for repeated stream snapshots", async () => {
    const { api, controller } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-cache-1",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text",
        links: [],
        toolCalls: [],
        snapshotSequence: 1,
        isFinal: false,
        updatedAt: 1777939200000,
      }),
    );
    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-cache-2",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text updated",
        links: [],
        toolCalls: [],
        snapshotSequence: 2,
        isFinal: false,
        updatedAt: 1777939200100,
      }),
    );

    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(sent(iosSocket)).toEqual([
      {
        type: "openclaw_message_stream_snapshot",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text",
        links: [],
        toolCalls: [],
        snapshotSequence: 1,
        isFinal: false,
        updatedAt: 1777939200000,
      },
      {
        type: "openclaw_message_stream_snapshot",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text updated",
        links: [],
        toolCalls: [],
        snapshotSequence: 2,
        isFinal: false,
        updatedAt: 1777939200100,
      },
    ]);
    expect(sent(pluginSocket)).toEqual([
      { type: "ack", requestId: "stream-request-cache-1" },
      { type: "ack", requestId: "stream-request-cache-2" },
    ]);
  });

  test("rejects iOS attempts to send OpenClaw stream snapshots", async () => {
    const { api, controller, pushBridge } = createController();
    const iosSocket = new FakeSocket();
    await authenticateIos(controller, iosSocket);
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "openclaw_message_stream_snapshot",
        requestId: "stream-request-2",
        streamId: "stream-message-1",
        sessionKey: "session-1",
        threadId: "thread-1",
        text: "Partial text",
        links: [],
        toolCalls: [],
        snapshotSequence: 1,
        isFinal: false,
        updatedAt: 1777939200000,
      }),
    );

    expect(api.openClawMessages).toEqual([]);
    expect(api.openClawMessageUpdates).toEqual([]);
    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      {
        type: "realtime_error",
        requestId: "stream-request-2",
        error: "command_not_allowed",
      },
    ]);
  });

  test("acks dropped archived OpenClaw updates with message id and drop metadata", async () => {
    const { api, controller, pushBridge } = createController();
    api.openClawMessageUpdateEvent = createEvent(13, "message_acknowledged", {
      threadId: "thread-archived",
      messageId: "message-archived",
      payload: { dropped: true, reason: "thread_archived" },
    });
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message_update",
        requestId: "request-dropped-update",
        idempotencyKey: "cowtail:update:message-archived:dropped",
        streamId: "cowtail:stream:message-archived",
        messageId: "message-archived",
        text: "This should be dropped",
        links: [],
        actions: [],
      }),
    );

    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      {
        ...api.openClawMessageUpdateEvent,
        payload: {
          dropped: true,
          reason: "thread_archived",
          streamId: "cowtail:stream:message-archived",
        },
      },
    ]);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-dropped-update",
        sequence: 13,
        payload: {
          threadId: "thread-archived",
          messageId: "message-archived",
          dropped: true,
          reason: "thread_archived",
        },
      },
    ]);
  });

  test("prunes an expired receive-only iOS socket before OpenClaw delivery and sends push fallback", async () => {
    const { api, controller, pushBridge, registry } = createController();
    api.appSessionExpiresAt = 0;
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-expired-delivery",
        idempotencyKey: "cowtail:reply:request-expired-delivery",
        streamId: "cowtail:stream:request-expired-delivery",
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    expect(api.validatedSessionIds).toEqual([]);
    expect(pushBridge.notifications).toEqual([
      withPersistedStreamId(api.openClawMessageEvent, "cowtail:stream:request-expired-delivery"),
    ]);
    expect(sent(iosSocket)).toEqual([{ type: "realtime_error", error: "unauthorized" }]);
    expect(iosSocket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-expired-delivery",
        sequence: 7,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("prunes a revoked receive-only iOS socket before OpenClaw delivery and sends push fallback", async () => {
    const { api, controller, pushBridge, registry } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    api.appSessionValidationOk = false;
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-revoked-delivery",
        idempotencyKey: "cowtail:reply:request-revoked-delivery",
        streamId: "cowtail:stream:request-revoked-delivery",
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(pushBridge.notifications).toEqual([
      withPersistedStreamId(api.openClawMessageEvent, "cowtail:stream:request-revoked-delivery"),
    ]);
    expect(sent(iosSocket)).toEqual([{ type: "realtime_error", error: "unauthorized" }]);
    expect(iosSocket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
    expect(sent(pluginSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-revoked-delivery",
        sequence: 7,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("API rejection during a command is contained and sends request-scoped realtime_error", async () => {
    const { api, controller } = createController();
    api.rejectOpenClawMessage = true;
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-4",
        idempotencyKey: "cowtail:reply:request-4",
        streamId: "cowtail:stream:request-4",
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    expect(sent(socket)).toEqual([
      { type: "realtime_error", requestId: "request-4", error: "command_failed" },
    ]);
    expect(socket.closeCalls).toEqual([]);
  });

  test("push rejection is contained and does not prevent plugin ack", async () => {
    const { controller, pushBridge } = createController();
    pushBridge.rejectNotifications = true;
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-5",
        idempotencyKey: "cowtail:reply:request-5",
        streamId: "cowtail:stream:request-5",
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushBridge.notifications.length).toBe(1);
    expect(sent(socket)).toEqual([
      {
        type: "ack",
        requestId: "request-5",
        sequence: 7,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
    expect(socket.closeCalls).toEqual([]);
  });

  test("push fallback is not awaited before plugin ack", async () => {
    const { controller, pushBridge } = createController();
    pushBridge.holdNotifications = true;
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    const result = await Promise.race([
      controller
        .handleRawMessage(
          "plugin-1",
          JSON.stringify({
            type: "openclaw_message",
            requestId: "request-6",
            idempotencyKey: "cowtail:reply:request-6",
            streamId: "cowtail:stream:request-6",
            sessionKey: "session-1",
            text: "Approve the deploy?",
            links: [],
            actions: [],
          }),
        )
        .then(() => "handled"),
      new Promise((resolve) => setTimeout(() => resolve("timed_out"), 10)),
    ]);

    expect(result).toBe("handled");
    expect(pushBridge.notifications.length).toBe(1);
    expect(sent(socket)).toEqual([
      {
        type: "ack",
        requestId: "request-6",
        sequence: 7,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);

    pushBridge.releaseHeldNotification?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("concurrent messages on the same connection are serialized in receipt order", async () => {
    const { api, controller } = createController();
    api.holdOpenClawMessages = true;
    const socket = new FakeSocket();
    await authenticatePlugin(controller, socket);
    socket.sentMessages.length = 0;

    const firstMessage = controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-7",
        idempotencyKey: "cowtail:reply:request-7",
        streamId: "cowtail:stream:request-7",
        sessionKey: "session-1",
        text: "first",
        links: [],
        actions: [],
      }),
    );
    const secondMessage = controller.handleRawMessage(
      "plugin-1",
      JSON.stringify({
        type: "openclaw_message",
        requestId: "request-8",
        idempotencyKey: "cowtail:reply:request-8",
        streamId: "cowtail:stream:request-8",
        sessionKey: "session-1",
        text: "second",
        links: [],
        actions: [],
      }),
    );

    await waitFor(() => api.heldOpenClawMessages.length === 1);
    expect(api.openClawMessages.map((command) => command.requestId)).toEqual(["request-7"]);

    api.heldOpenClawMessages[0]?.resolve(createOpenClawMessageEvent(10));
    await waitFor(() => api.heldOpenClawMessages.length === 2);
    expect(api.openClawMessages.map((command) => command.requestId)).toEqual([
      "request-7",
      "request-8",
    ]);

    api.heldOpenClawMessages[1]?.resolve(createOpenClawMessageEvent(11));
    await Promise.all([firstMessage, secondMessage]);

    expect(sent(socket)).toEqual([
      {
        type: "ack",
        requestId: "request-7",
        sequence: 10,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
      {
        type: "ack",
        requestId: "request-8",
        sequence: 11,
        payload: { threadId: "thread-openclaw", messageId: "message-openclaw" },
      },
    ]);
  });

  test("forwards ios_reply events to OpenClaw plugin clients and iOS clients", async () => {
    const { api, controller } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_reply",
        requestId: "request-2",
        idempotencyKey: "ios:reply:request-2",
        threadId: "thread-1",
        text: "Ship it",
      }),
    );

    expect(api.verifiedSessionTokens).toEqual(["app-session-token"]);
    expect(api.validatedSessionIds).toEqual(["session-1", "session-1"]);
    expect(api.iosReplies).toEqual([
      {
        type: "ios_reply",
        requestId: "request-2",
        idempotencyKey: "ios:reply:request-2",
        threadId: "thread-1",
        text: "Ship it",
      },
    ]);
    expect(sent(pluginSocket)).toEqual([api.iosReplyEvent]);
    expect(sent(iosSocket)).toEqual([
      api.iosReplyEvent,
      {
        type: "ack",
        requestId: "request-2",
        sequence: 9,
        payload: { threadId: "thread-1", messageId: "message-ios" },
      },
    ]);
  });

  test("duplicate ios_reply acks without forwarding the old event again", async () => {
    const { api, controller } = createController();
    api.duplicateIosReply = true;
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_reply",
        requestId: "request-duplicate-reply",
        idempotencyKey: "ios:reply:request-duplicate-reply",
        threadId: "thread-1",
        text: "Ship it",
      }),
    );

    expect(sent(pluginSocket)).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      {
        type: "ack",
        requestId: "request-duplicate-reply",
        sequence: 9,
        payload: {
          threadId: "thread-1",
          messageId: "message-ios",
          duplicate: true,
          reason: "duplicate_idempotency_key",
        },
      },
    ]);
  });

  test("forwards ios_new_thread events with ack reconciliation payload", async () => {
    const { api, controller } = createController();
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_new_thread",
        requestId: "request-new-thread",
        idempotencyKey: "ios:new-thread:request-new-thread",
        title: "Deploy",
        text: "Start check",
      }),
    );

    expect(api.iosThreads).toEqual([
      {
        type: "ios_new_thread",
        requestId: "request-new-thread",
        idempotencyKey: "ios:new-thread:request-new-thread",
        title: "Deploy",
        text: "Start check",
      },
    ]);
    expect(sent(pluginSocket)).toEqual([sent(iosSocket)[0]]);
    expect(sent(iosSocket)).toEqual([
      {
        sequence: 3,
        type: "thread_created",
        createdAt: 103,
        threadId: "thread-1",
        messageId: "message-ios-thread",
        thread: {
          id: "thread-1",
          status: "pending",
          targetAgent: "default",
          title: "Deploy",
          unreadCount: 0,
          createdAt: 100,
          updatedAt: 100,
          lastMessageAt: 100,
        },
        message: {
          id: "message-ios-thread",
          threadId: "thread-1",
          direction: "user_to_openclaw",
          text: "Start check",
          links: [],
          toolCalls: [],
          deliveryState: "sent",
          createdAt: 100,
          updatedAt: 100,
        },
        payload: { text: "Start check" },
      },
      {
        type: "ack",
        requestId: "request-new-thread",
        sequence: 3,
        payload: { threadId: "thread-1", messageId: "message-ios-thread" },
      },
    ]);
  });

  test("does not forward archived ios_reply events to OpenClaw plugin clients", async () => {
    const { api, controller } = createController();
    api.iosReplyEvent = createEvent(14, "reply_created", {
      threadId: "thread-archived",
      messageId: "message-archived",
      thread: {
        id: "thread-archived",
        sessionKey: "session-archived",
        status: "archived",
        targetAgent: "default",
        title: "Archived chat",
        unreadCount: 0,
        createdAt: 100,
        updatedAt: 200,
      },
      message: {
        id: "message-archived",
        threadId: "thread-archived",
        direction: "user_to_openclaw",
        text: "Stale reply",
        links: [],
        toolCalls: [],
        deliveryState: "sent",
        createdAt: 100,
        updatedAt: 100,
      },
    });
    const pluginSocket = new FakeSocket();
    const iosSocket = new FakeSocket();
    await authenticatePlugin(controller, pluginSocket);
    await authenticateIos(controller, iosSocket);
    pluginSocket.sentMessages.length = 0;
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_reply",
        requestId: "request-archived-reply",
        idempotencyKey: "ios:reply:request-archived-reply",
        threadId: "thread-archived",
        text: "Stale reply",
      }),
    );

    expect(sent(pluginSocket)).toEqual([]);
    expect(sent(iosSocket)).toEqual([
      api.iosReplyEvent,
      {
        type: "ack",
        requestId: "request-archived-reply",
        sequence: 14,
        payload: { threadId: "thread-archived", messageId: "message-archived" },
      },
    ]);
  });

  test("renames and deletes threads from authenticated iOS clients", async () => {
    const { api, controller } = createController();
    const iosSocket = new FakeSocket();
    await authenticateIos(controller, iosSocket);
    iosSocket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_rename_thread",
        requestId: "request-rename",
        idempotencyKey: "ios:rename:request-rename",
        threadId: "thread-1",
        title: "Renamed chat",
      }),
    );

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_delete_thread",
        requestId: "request-delete",
        idempotencyKey: "ios:delete:request-delete",
        threadId: "thread-1",
      }),
    );

    expect(api.renamedThreads).toEqual([
      {
        type: "ios_rename_thread",
        requestId: "request-rename",
        idempotencyKey: "ios:rename:request-rename",
        threadId: "thread-1",
        title: "Renamed chat",
      },
    ]);
    expect(api.deletedThreads).toEqual([
      {
        type: "ios_delete_thread",
        requestId: "request-delete",
        idempotencyKey: "ios:delete:request-delete",
        threadId: "thread-1",
      },
    ]);
    expect(sent(iosSocket)).toEqual([
      {
        sequence: 10,
        type: "thread_updated",
        createdAt: 110,
        threadId: "thread-1",
        thread: {
          id: "thread-1",
          sessionKey: "session-1",
          status: "active",
          targetAgent: "default",
          title: "Renamed chat",
          unreadCount: 0,
          createdAt: 100,
          updatedAt: 200,
        },
      },
      {
        type: "ack",
        requestId: "request-rename",
        sequence: 10,
        payload: { threadId: "thread-1" },
      },
      {
        sequence: 11,
        type: "thread_updated",
        createdAt: 111,
        threadId: "thread-1",
        thread: {
          id: "thread-1",
          sessionKey: "session-1",
          status: "archived",
          targetAgent: "default",
          title: "Deleted thread",
          unreadCount: 0,
          createdAt: 100,
          updatedAt: 200,
        },
        payload: { deleted: true },
      },
      {
        type: "ack",
        requestId: "request-delete",
        sequence: 11,
        payload: { threadId: "thread-1" },
      },
    ]);
  });

  test("rejects an expired iOS session before processing a command, closes, and detaches", async () => {
    const { api, controller, registry } = createController();
    api.appSessionExpiresAt = 0;
    const socket = new FakeSocket();
    await authenticateIos(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_new_thread",
        requestId: "request-expired",
        idempotencyKey: "ios:new-thread:request-expired",
        text: "Start thread",
      }),
    );

    expect(api.validatedSessionIds).toEqual([]);
    expect(api.iosThreads).toEqual([]);
    expect(sent(socket)).toEqual([
      { type: "realtime_error", requestId: "request-expired", error: "unauthorized" },
    ]);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
  });

  test("rejects a revoked iOS session before processing a command, closes, and detaches", async () => {
    const { api, controller, registry } = createController();
    api.appSessionValidationOk = false;
    const socket = new FakeSocket();
    await authenticateIos(controller, socket);
    socket.sentMessages.length = 0;

    await controller.handleRawMessage(
      "ios-1",
      JSON.stringify({
        type: "ios_reply",
        requestId: "request-revoked",
        idempotencyKey: "ios:reply:request-revoked",
        threadId: "thread-1",
        text: "Ship it",
      }),
    );

    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(api.iosReplies).toEqual([]);
    expect(sent(socket)).toEqual([
      { type: "realtime_error", requestId: "request-revoked", error: "unauthorized" },
    ]);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "unauthorized" }]);
    expect(registry.getClient("ios-1")).toBe(undefined);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}
