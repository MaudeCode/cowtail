import {
  openclawRealtimeServerMessageSchema,
  type OpenClawActionResultCommand,
  type OpenClawEventEnvelope,
  type OpenClawPluginMessageCommand,
  type OpenClawRealtimeError,
  type OpenClawSessionBoundCommand,
} from "@maudecode/cowtail-protocol";

import type { CowtailStateStore } from "./state-store.js";
import type { ResolvedCowtailAccount } from "./types.js";

type Logger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type TimerHandle = any;

type TimerApi = {
  setTimeout: (handler: () => void, timeout?: number) => TimerHandle;
  clearTimeout: (timer: TimerHandle | undefined) => void;
};

export type WebSocketLike = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type PendingRequest = {
  resolve: (result: CowtailCommandResult) => void;
  reject: (error: Error) => void;
};

type HandshakeState = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

export type CowtailCommandResult = {
  requestId: string;
  sequence: number | undefined;
};

export type CowtailRealtimeClientDeps = {
  account: ResolvedCowtailAccount;
  stateStore: Pick<CowtailStateStore, "readLastSeenSequence" | "writeLastSeenSequence">;
  logger?: Logger;
  onEvent: (event: OpenClawEventEnvelope) => void | Promise<void>;
  webSocketFactory?: (url: string) => WebSocketLike;
  timers?: TimerApi;
  requestIdFactory?: () => string;
};

export type OpenClawMessageInput = Omit<OpenClawPluginMessageCommand, "requestId" | "links" | "actions"> &
  Partial<Pick<OpenClawPluginMessageCommand, "links" | "actions">>;
export type OpenClawSessionBoundInput = Omit<OpenClawSessionBoundCommand, "requestId">;
export type OpenClawActionResultInput = Omit<OpenClawActionResultCommand, "requestId">;

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as WebSocketLike;
}

function defaultRequestIdFactory(): string {
  return crypto.randomUUID();
}

function reconnectDelayForAttempt(
  attempt: number,
  minDelayMs: number,
  maxDelayMs: number,
): number {
  const exponent = Math.max(attempt - 1, 0);
  return Math.min(maxDelayMs, minDelayMs * 2 ** exponent);
}

export class CowtailRealtimeClient {
  readonly #account: ResolvedCowtailAccount;
  readonly #stateStore: Pick<CowtailStateStore, "readLastSeenSequence" | "writeLastSeenSequence">;
  readonly #logger: Logger | undefined;
  readonly #onEvent: (event: OpenClawEventEnvelope) => void | Promise<void>;
  readonly #webSocketFactory: (url: string) => WebSocketLike;
  readonly #timers: TimerApi;
  readonly #requestIdFactory: () => string;

  #socket: WebSocketLike | undefined;
  #started = false;
  #connectTimeoutTimer: TimerHandle | undefined;
  #reconnectTimer: TimerHandle | undefined;
  #reconnectAttempt = 0;
  #handshake: HandshakeState | undefined;
  #pendingRequests = new Map<string, PendingRequest>();

  constructor(deps: CowtailRealtimeClientDeps) {
    this.#account = deps.account;
    this.#stateStore = deps.stateStore;
    this.#logger = deps.logger;
    this.#onEvent = deps.onEvent;
    this.#webSocketFactory = deps.webSocketFactory ?? defaultWebSocketFactory;
    this.#timers = deps.timers ?? globalThis;
    this.#requestIdFactory = deps.requestIdFactory ?? defaultRequestIdFactory;
  }

  start(): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#reconnectAttempt = 0;
    this.#connect();
  }

  stop(): void {
    this.#started = false;
    this.#clearConnectTimeout();
    this.#clearReconnectTimer();
    this.#closeSocket();
  }

  sendOpenClawMessage(command: OpenClawMessageInput): Promise<CowtailCommandResult> {
    return this.#sendCommand({
      ...command,
      requestId: this.#requestIdFactory(),
      links: command.links ?? [],
      actions: command.actions ?? [],
    });
  }

  sendSessionBound(command: OpenClawSessionBoundInput): Promise<number | undefined> {
    return this.#sendCommand({
      ...command,
      requestId: this.#requestIdFactory(),
    }).then((result) => result.sequence);
  }

  sendActionResult(command: OpenClawActionResultInput): Promise<number | undefined> {
    return this.#sendCommand({
      ...command,
      requestId: this.#requestIdFactory(),
    }).then((result) => result.sequence);
  }

  #connect(): void {
    if (!this.#started || this.#socket) {
      return;
    }

    const socket = this.#webSocketFactory(this.#account.url);
    const handshake = this.#createHandshakeState();
    this.#socket = socket;
    this.#handshake = handshake;
    this.#armConnectTimeout(socket, handshake, "connect");

    socket.onopen = () => {
      this.#runOpen(socket, handshake);
    };
    socket.onmessage = (event) => {
      this.#runMessage(socket, event.data);
    };
    socket.onclose = () => {
      this.#handleClose(socket);
    };
    socket.onerror = () => {
      this.#logger?.warn?.("Cowtail websocket error");
    };
  }

  #runOpen(socket: WebSocketLike, handshake: HandshakeState): void {
    this.#clearConnectTimeout();
    this.#armConnectTimeout(socket, handshake, "handshake");
    void this.#handleOpen(socket, handshake).catch((error) => {
      this.#logger?.error?.(
        `Cowtail websocket open handling failed: ${this.#errorMessage(error)}`,
      );
      this.#terminateSocket(socket, "open_failed");
    });
  }

  #runMessage(socket: WebSocketLike, rawMessage: unknown): void {
    void this.#handleMessage(socket, rawMessage).catch((error) => {
      this.#logger?.error?.(
        `Cowtail websocket message handling failed: ${this.#errorMessage(error)}`,
      );
      this.#terminateSocket(socket, "message_failed");
    });
  }

  async #handleOpen(socket: WebSocketLike, handshake: HandshakeState): Promise<void> {
    if (socket !== this.#socket || !this.#isSocketOpen(socket)) {
      return;
    }

    let lastSeenSequence: number | undefined;
    try {
      lastSeenSequence = await this.#stateStore.readLastSeenSequence();
    } catch {
      this.#logger?.warn?.("Cowtail websocket failed to load replay cursor");
    }

    if (socket !== this.#socket || handshake !== this.#handshake || !this.#isSocketOpen(socket)) {
      return;
    }

    const hello =
      lastSeenSequence === undefined
        ? {
            protocolVersion: 1 as const,
            clientKind: "openclaw_plugin" as const,
            token: this.#account.bridgeToken,
          }
        : {
            protocolVersion: 1 as const,
            clientKind: "openclaw_plugin" as const,
            token: this.#account.bridgeToken,
            lastSeenSequence,
          };

    try {
      socket.send(JSON.stringify(hello));
      this.#clearConnectTimeout();
      this.#reconnectAttempt = 0;
      handshake.resolve();
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("Cowtail websocket handshake send failed");
      handshake.reject(failure);
      throw failure;
    }
  }

  async #handleMessage(socket: WebSocketLike, rawMessage: unknown): Promise<void> {
    if (socket !== this.#socket) {
      return;
    }

    if (typeof rawMessage !== "string") {
      this.#logger?.warn?.("Cowtail websocket received a non-string message");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawMessage);
    } catch {
      this.#logger?.warn?.("Cowtail websocket received invalid JSON");
      return;
    }

    const parsed = openclawRealtimeServerMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.#logger?.warn?.("Cowtail websocket received an invalid server message");
      return;
    }

    const message = parsed.data;
    if (message.type === "ack") {
      this.#resolvePendingRequest(message.requestId, message.sequence);
      return;
    }

    if (message.type === "realtime_error") {
      this.#rejectPendingRequest(message);
      return;
    }

    await this.#stateStore.writeLastSeenSequence(message.sequence);
    await this.#onEvent(message);
  }

  #handleClose(socket: WebSocketLike): void {
    if (socket !== this.#socket) {
      return;
    }

    this.#clearConnectTimeout();
    this.#socket = undefined;
    this.#rejectHandshake(new Error("Cowtail websocket closed"));
    this.#rejectAllPendingRequests(new Error("Cowtail websocket closed"));

    if (!this.#started) {
      return;
    }

    const attempt = this.#reconnectAttempt + 1;
    this.#reconnectAttempt = attempt;
    const delayMs = reconnectDelayForAttempt(
      attempt,
      this.#account.reconnectMinDelayMs,
      this.#account.reconnectMaxDelayMs,
    );
    this.#reconnectTimer = this.#timers.setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#connect();
    }, delayMs);
  }

  #closeSocket(): void {
    const socket = this.#socket;
    this.#clearConnectTimeout();
    this.#socket = undefined;
    this.#rejectHandshake(new Error("Cowtail websocket closed"));
    this.#rejectAllPendingRequests(new Error("Cowtail websocket closed"));

    if (!socket) {
      return;
    }

    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    try {
      socket.close(1000, "client_stopped");
    } catch {
      this.#logger?.warn?.("Cowtail websocket close failed");
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer === undefined) {
      return;
    }

    this.#timers.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
  }

  #clearConnectTimeout(): void {
    if (this.#connectTimeoutTimer === undefined) {
      return;
    }

    this.#timers.clearTimeout(this.#connectTimeoutTimer);
    this.#connectTimeoutTimer = undefined;
  }

  async #sendCommand(
    command: OpenClawPluginMessageCommand | OpenClawSessionBoundCommand | OpenClawActionResultCommand,
  ): Promise<CowtailCommandResult> {
    const socket = this.#socket;
    const handshake = this.#handshake;
    if (!socket || !handshake) {
      throw new Error("Cowtail websocket is disconnected");
    }

    await handshake.promise;

    const currentSocket = this.#socket;
    if (
      !currentSocket ||
      socket !== currentSocket ||
      handshake !== this.#handshake ||
      !this.#isSocketOpen(currentSocket)
    ) {
      throw new Error("Cowtail websocket is disconnected");
    }

    return new Promise<CowtailCommandResult>((resolve, reject) => {
      this.#pendingRequests.set(command.requestId, { resolve, reject });
      try {
        currentSocket.send(JSON.stringify(command));
      } catch (error) {
        this.#pendingRequests.delete(command.requestId);
        reject(error instanceof Error ? error : new Error("Cowtail websocket send failed"));
      }
    });
  }

  #resolvePendingRequest(requestId: string, sequence: number | undefined): void {
    const pending = this.#pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    this.#pendingRequests.delete(requestId);
    pending.resolve({ requestId, sequence });
  }

  #rejectPendingRequest(message: OpenClawRealtimeError): void {
    if (!message.requestId) {
      this.#logger?.warn?.(`Cowtail websocket error: ${message.error}`);
      return;
    }

    const pending = this.#pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    this.#pendingRequests.delete(message.requestId);
    pending.reject(new Error(message.error));
  }

  #rejectAllPendingRequests(error: Error): void {
    for (const [requestId, pending] of this.#pendingRequests) {
      this.#pendingRequests.delete(requestId);
      pending.reject(error);
    }
  }

  #createHandshakeState(): HandshakeState {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    void promise.catch(() => undefined);
    return { promise, resolve, reject };
  }

  #rejectHandshake(error: Error): void {
    if (!this.#handshake) {
      return;
    }

    const handshake = this.#handshake;
    this.#handshake = undefined;
    handshake.reject(error);
  }

  #isSocketOpen(socket: WebSocketLike): boolean {
    return socket.readyState === 1;
  }

  #armConnectTimeout(
    socket: WebSocketLike,
    handshake: HandshakeState,
    phase: "connect" | "handshake",
  ): void {
    this.#clearConnectTimeout();
    this.#connectTimeoutTimer = this.#timers.setTimeout(() => {
      this.#connectTimeoutTimer = undefined;
      if (socket !== this.#socket || handshake !== this.#handshake) {
        return;
      }

      if (phase === "connect" && socket.readyState !== 0) {
        return;
      }

      this.#logger?.warn?.(`Cowtail websocket ${phase} timed out`);
      this.#terminateSocket(socket, `${phase}_timeout`);
    }, this.#account.connectTimeoutMs);
  }

  #terminateSocket(socket: WebSocketLike, reason: string): void {
    if (socket !== this.#socket) {
      return;
    }

    this.#clearConnectTimeout();
    try {
      socket.close(1011, reason);
    } catch {
      this.#handleClose(socket);
    }
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
