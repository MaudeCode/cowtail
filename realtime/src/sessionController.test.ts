import { describe, expect, test } from "bun:test";
import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import type { CowtailRealtimeApi } from "./cowtailApi";
import { RealtimeConnectionRegistry } from "./connectionRegistry";
import type { OpenClawPushBridge, PushBridgeResult } from "./pushBridge";
import { OpenClawSessionController } from "./sessionController";

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
  public readonly heldOpenClawMessages: Array<{
    command: Parameters<CowtailRealtimeApi["createOpenClawMessage"]>[0];
    resolve: (event: OpenClawEventEnvelope) => void;
  }> = [];
  public readonly openClawMessages: Parameters<CowtailRealtimeApi["createOpenClawMessage"]>[0][] =
    [];
  public readonly iosThreads: Parameters<CowtailRealtimeApi["createIosThread"]>[0][] = [];
  public readonly iosReplies: Parameters<CowtailRealtimeApi["createIosReply"]>[0][] = [];
  public appSessionUserId = "owner-user-id";
  public appSessionSessionId = "session-1";
  public appSessionExpiresAt = Date.now() + 60_000;
  public openClawMessageEvent = createOpenClawMessageEvent(7);
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
      return await new Promise<OpenClawEventEnvelope>((resolve) => {
        this.heldOpenClawMessages.push({ command, resolve });
      });
    }
    return this.openClawMessageEvent;
  }

  async createIosThread(command: Parameters<CowtailRealtimeApi["createIosThread"]>[0]) {
    this.iosThreads.push(command);
    return createEvent(3, "thread_created", {
      threadId: "thread-1",
      payload: { text: command.text },
    });
  }

  async createIosReply(command: Parameters<CowtailRealtimeApi["createIosReply"]>[0]) {
    this.iosReplies.push(command);
    return this.iosReplyEvent;
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
      deliveryState: "sent",
      createdAt: 100,
      updatedAt: 100,
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
      createEvent(4, "message_created"),
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
        sessionKey: "session-1",
        title: "Deploy",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    expect(api.openClawMessages).toEqual([
      {
        type: "openclaw_message",
        requestId: "request-1",
        sessionKey: "session-1",
        title: "Deploy",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      },
    ]);
    expect(pushBridge.notifications).toEqual([api.openClawMessageEvent]);
    expect(sent(socket)).toEqual([{ type: "ack", requestId: "request-1", sequence: 7 }]);
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
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    expect(pushBridge.notifications).toEqual([]);
    expect(sent(iosSocket)).toEqual([api.openClawMessageEvent]);
    expect(sent(pluginSocket)).toEqual([{ type: "ack", requestId: "request-3", sequence: 7 }]);
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
        sessionKey: "session-1",
        text: "Approve the deploy?",
        links: [],
        actions: [],
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushBridge.notifications.length).toBe(1);
    expect(sent(socket)).toEqual([{ type: "ack", requestId: "request-5", sequence: 7 }]);
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
    expect(sent(socket)).toEqual([{ type: "ack", requestId: "request-6", sequence: 7 }]);

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
      { type: "ack", requestId: "request-7", sequence: 10 },
      { type: "ack", requestId: "request-8", sequence: 11 },
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
        threadId: "thread-1",
        text: "Ship it",
      }),
    );

    expect(api.verifiedSessionTokens).toEqual(["app-session-token"]);
    expect(api.validatedSessionIds).toEqual(["session-1"]);
    expect(api.iosReplies).toEqual([
      {
        type: "ios_reply",
        requestId: "request-2",
        threadId: "thread-1",
        text: "Ship it",
      },
    ]);
    expect(sent(pluginSocket)).toEqual([api.iosReplyEvent]);
    expect(sent(iosSocket)).toEqual([
      api.iosReplyEvent,
      { type: "ack", requestId: "request-2", sequence: 9 },
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
