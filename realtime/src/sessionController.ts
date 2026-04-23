import {
  openclawRealtimeClientMessageSchema,
  type OpenClawEventEnvelope,
  type OpenClawRealtimeAck,
  type OpenClawRealtimeError,
  type OpenClawRealtimeServerMessage,
} from "@maudecode/cowtail-protocol";

import { authenticateClientHello, type RealtimeClient } from "./auth";
import type { CowtailRealtimeApi } from "./cowtailApi";
import type { RealtimeSocket } from "./connectionRegistry";
import { RealtimeConnectionRegistry } from "./connectionRegistry";
import type { OpenClawPushBridge } from "./pushBridge";

export type OpenClawSessionControllerDeps = {
  bridgeToken: string;
  ownerUserId: string;
  api: CowtailRealtimeApi;
  registry: RealtimeConnectionRegistry;
  pushBridge: OpenClawPushBridge;
};

type AttachedConnection = {
  socket: RealtimeSocket;
  client?: RealtimeClient;
};

export function helloAcknowledged(client: RealtimeClient): OpenClawEventEnvelope {
  const payload: Record<string, string> = {
    clientKind: client.kind,
  };

  if (client.kind === "ios") {
    payload.userId = client.userId;
  }

  return {
    sequence: 0,
    type: "hello_acknowledged",
    createdAt: 0,
    payload,
  };
}

export function ack(requestId: string, sequence?: number): OpenClawRealtimeAck {
  return sequence === undefined
    ? {
        type: "ack",
        requestId,
      }
    : {
        type: "ack",
        requestId,
        sequence,
      };
}

export function realtimeError(error: string, requestId?: string): OpenClawRealtimeError {
  return requestId === undefined
    ? {
        type: "realtime_error",
        error,
      }
    : {
        type: "realtime_error",
        requestId,
        error,
      };
}

export function shouldReplayToClient(
  client: RealtimeClient,
  event: OpenClawEventEnvelope,
): boolean {
  if (client.kind === "ios") {
    return true;
  }

  return (
    event.type === "thread_created" ||
    event.type === "reply_created" ||
    event.type === "action_submitted"
  );
}

export class OpenClawSessionController {
  readonly #bridgeToken: string;
  readonly #ownerUserId: string;
  readonly #api: CowtailRealtimeApi;
  readonly #registry: RealtimeConnectionRegistry;
  readonly #pushBridge: OpenClawPushBridge;
  readonly #connections = new Map<string, AttachedConnection>();
  readonly #messageQueues = new Map<string, Promise<void>>();

  constructor(deps: OpenClawSessionControllerDeps) {
    this.#bridgeToken = deps.bridgeToken;
    this.#ownerUserId = deps.ownerUserId;
    this.#api = deps.api;
    this.#registry = deps.registry;
    this.#pushBridge = deps.pushBridge;
  }

  attach(connectionId: string, socket: RealtimeSocket): void {
    this.#connections.set(connectionId, { socket });
  }

  detach(connectionId: string): void {
    this.#connections.delete(connectionId);
    this.#registry.remove(connectionId);
    this.#messageQueues.delete(connectionId);
  }

  async handleRawMessage(connectionId: string, rawMessage: string): Promise<void> {
    const previous = this.#messageQueues.get(connectionId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#handleRawMessageNow(connectionId, rawMessage));
    this.#messageQueues.set(connectionId, current);

    try {
      await current;
    } finally {
      if (this.#messageQueues.get(connectionId) === current) {
        this.#messageQueues.delete(connectionId);
      }
    }
  }

  async #handleRawMessageNow(connectionId: string, rawMessage: string): Promise<void> {
    const connection = this.#connections.get(connectionId);
    if (!connection) {
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(rawMessage);
    } catch {
      this.#send(connectionId, realtimeError("invalid_json"));
      return;
    }

    if (!connection.client) {
      await this.#authenticate(connectionId, connection, value);
      return;
    }

    await this.#handleCommand(connectionId, connection.client, value);
  }

  async #authenticate(
    connectionId: string,
    connection: AttachedConnection,
    value: unknown,
  ): Promise<void> {
    let auth: Awaited<ReturnType<typeof authenticateClientHello>>;
    try {
      auth = await authenticateClientHello(value, {
        bridgeToken: this.#bridgeToken,
        verifyAppSessionToken: (appSessionToken) =>
          this.#api.verifyAppSessionToken(appSessionToken),
      });
    } catch {
      this.#send(connectionId, realtimeError("auth_failed"));
      connection.socket.close(1008, "auth_failed");
      this.detach(connectionId);
      return;
    }

    if (!auth.ok) {
      this.#send(connectionId, realtimeError(auth.reason));
      connection.socket.close(1008, auth.reason);
      this.detach(connectionId);
      return;
    }

    if (auth.client.kind === "ios" && auth.client.userId !== this.#ownerUserId) {
      this.#send(connectionId, realtimeError("unauthorized"));
      connection.socket.close(1008, "unauthorized");
      this.detach(connectionId);
      return;
    }

    connection.client = auth.client;
    this.#registry.add(connectionId, connection.socket, auth.client);
    this.#send(connectionId, helloAcknowledged(auth.client));

    if (auth.client.lastSeenSequence !== undefined) {
      try {
        const replayEvents = await this.#api.replayEvents(auth.client.lastSeenSequence);
        for (const event of replayEvents) {
          if (shouldReplayToClient(auth.client, event)) {
            this.#send(connectionId, event);
          }
        }
      } catch {
        this.#send(connectionId, realtimeError("replay_failed"));
      }
    }
  }

  async #handleCommand(
    connectionId: string,
    client: RealtimeClient,
    value: unknown,
  ): Promise<void> {
    const parsed = openclawRealtimeClientMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.#send(connectionId, realtimeError("invalid_command", getRequestId(value)));
      return;
    }

    const command = parsed.data;
    if (!isCommandAllowedForClient(client, command.type)) {
      this.#send(connectionId, realtimeError("command_not_allowed", command.requestId));
      return;
    }

    switch (command.type) {
      case "openclaw_message": {
        try {
          const event = await this.#api.createOpenClawMessage(command);
          const delivered = this.#registry.broadcastToIos(event);
          if (delivered === 0) {
            this.#sendPushFallback(event);
          }
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      case "ios_new_thread": {
        try {
          const event = await this.#api.createIosThread(command);
          this.#broadcastToOpenClawAndIos(event);
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      case "ios_reply": {
        try {
          const event = await this.#api.createIosReply(command);
          this.#broadcastToOpenClawAndIos(event);
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      case "ios_action": {
        try {
          const event = await this.#api.submitIosAction(command);
          this.#broadcastToOpenClawAndIos(event);
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      case "ios_mark_thread_read": {
        try {
          const event = await this.#api.markThreadRead(command);
          this.#registry.broadcastToIos(event);
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      case "openclaw_session_bound": {
        try {
          const event = await this.#api.bindThreadSession(command);
          this.#registry.broadcastToIos(event);
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      case "openclaw_action_result": {
        try {
          const event = await this.#api.recordActionResult(command);
          this.#registry.broadcastToIos(event);
          this.#send(connectionId, ack(command.requestId, event.sequence));
        } catch {
          this.#send(connectionId, realtimeError("command_failed", command.requestId));
        }
        break;
      }

      default:
        assertNever(command);
    }
  }

  #broadcastToOpenClawAndIos(event: OpenClawEventEnvelope): void {
    this.#registry.broadcastToOpenClaw(event);
    this.#registry.broadcastToIos(event);
  }

  #send(connectionId: string, message: OpenClawRealtimeServerMessage): boolean {
    if (this.#registry.send(connectionId, message)) {
      return true;
    }

    const connection = this.#connections.get(connectionId);
    if (!connection || connection.client || connection.socket.readyState !== 1) {
      this.detach(connectionId);
      return false;
    }

    try {
      connection.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.detach(connectionId);
      return false;
    }
  }

  #sendPushFallback(event: OpenClawEventEnvelope): void {
    try {
      void this.#pushBridge.sendOpenClawMessageNotification(event).catch(() => undefined);
    } catch {
      // Push fallback is best effort and must not affect websocket command handling.
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled OpenClaw realtime command: ${JSON.stringify(value)}`);
}

function isCommandAllowedForClient(client: RealtimeClient, commandType: string): boolean {
  if (client.kind === "openclaw_plugin") {
    return (
      commandType === "openclaw_message" ||
      commandType === "openclaw_session_bound" ||
      commandType === "openclaw_action_result"
    );
  }

  return (
    commandType === "ios_new_thread" ||
    commandType === "ios_reply" ||
    commandType === "ios_action" ||
    commandType === "ios_mark_thread_read"
  );
}

function getRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}
