import { describe, expect, test } from "bun:test";

import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import { CowtailRealtimeClient } from "./client.js";
import type { ResolvedCowtailAccount } from "./types.js";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  readonly #listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set<(event: Event) => void>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  send(value: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("socket is not open");
    }
    this.sent.push(value);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close", { code, reason, wasClean: true } as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#emit("open", new Event("open"));
  }

  message(value: unknown): void {
    this.messageRaw(JSON.stringify(value));
  }

  messageRaw(raw: string): void {
    this.#emit(
      "message",
      {
        data: raw,
      } as MessageEvent<string>,
    );
  }

  #emit(type: string, event: Event): void {
    if (type === "open") {
      this.onopen?.(event);
    } else if (type === "message") {
      this.onmessage?.(event as MessageEvent<string>);
    } else if (type === "close") {
      this.onclose?.(event as CloseEvent);
    } else if (type === "error") {
      this.onerror?.(event);
    }

    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeTimers {
  readonly scheduled: Array<{
    id: number;
    delay: number;
    callback: () => void;
    cleared: boolean;
  }> = [];

  #nextId = 1;

  setTimeout = (callback: () => void, delay?: number): number => {
    const id = this.#nextId++;
    this.scheduled.push({
      id,
      delay: delay ?? 0,
      callback,
      cleared: false,
    });
    return id;
  };

  clearTimeout = (id: number): void => {
    const timer = this.scheduled.find((entry) => entry.id === id);
    if (timer) {
      timer.cleared = true;
    }
  };

  runNext(): void {
    const timer = this.scheduled.find((entry) => !entry.cleared);
    if (!timer) {
      throw new Error("No timer queued");
    }
    timer.cleared = true;
    timer.callback();
  }
}

function createAccount(
  overrides: Partial<ResolvedCowtailAccount> = {},
): ResolvedCowtailAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    url: "wss://cowtail.example.invalid/openclaw/realtime",
    bridgeToken: "bridge-token",
    bridgeTokenSource: "config",
    agentId: "main",
    connectTimeoutMs: 5_000,
    reconnectMinDelayMs: 100,
    reconnectMaxDelayMs: 250,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("CowtailRealtimeClient", () => {
  test("sends plugin hello with token and stored replay cursor on open", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: async () => 17,
        writeLastSeenSequence: async () => undefined,
      },
      onEvent: () => undefined,
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    client.start();
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    await flushMicrotasks();

    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      protocolVersion: 1,
      clientKind: "openclaw_plugin",
      token: "bridge-token",
      lastSeenSequence: 17,
    });
  });

  test("sends hello before queued command frames when replay cursor load is delayed", async () => {
    const sockets: FakeWebSocket[] = [];
    const cursor = createDeferred<number | undefined>();
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: () => cursor.promise,
        writeLastSeenSequence: async () => undefined,
      },
      onEvent: () => undefined,
      requestIdFactory: () => "request-delayed",
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    client.start();
    sockets[0]!.open();

    const pending = client.sendOpenClawMessage({
      type: "openclaw_message",
      sessionKey: "session-delayed",
      text: "queued",
    });

    await flushMicrotasks();
    expect(sockets[0]!.sent).toHaveLength(0);

    cursor.resolve(88);
    await flushMicrotasks();

    expect(sockets[0]!.sent).toHaveLength(2);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      protocolVersion: 1,
      clientKind: "openclaw_plugin",
      token: "bridge-token",
      lastSeenSequence: 88,
    });
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({
      type: "openclaw_message",
      requestId: "request-delayed",
      sessionKey: "session-delayed",
      text: "queued",
      links: [],
      actions: [],
    });

    sockets[0]!.message({
      type: "ack",
      requestId: "request-delayed",
      sequence: 101,
    });

    await expect(pending).resolves.toBe(101);
  });

  test("resolves command promises when matching ack arrives", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: async () => undefined,
        writeLastSeenSequence: async () => undefined,
      },
      onEvent: () => undefined,
      requestIdFactory: () => "request-1",
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    client.start();
    sockets[0]!.open();
    await flushMicrotasks();

    let resolved = false;
    const pending = client
      .sendOpenClawMessage({
        type: "openclaw_message",
        sessionKey: "session-1",
        text: "hello",
      })
      .then((value) => {
        resolved = true;
        return value;
      });

    await flushMicrotasks();
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({
      type: "openclaw_message",
      requestId: "request-1",
      sessionKey: "session-1",
      text: "hello",
      links: [],
      actions: [],
    });

    sockets[0]!.message({
      type: "ack",
      requestId: "request-other",
      sequence: 11,
    });
    await flushMicrotasks();
    expect(resolved).toBe(false);

    sockets[0]!.message({
      type: "ack",
      requestId: "request-1",
      sequence: 42,
    });

    await expect(pending).resolves.toBe(42);
  });

  test("persists last seen sequence for event envelopes before dispatch", async () => {
    const writeCalls: number[] = [];
    const observedWriteState: number[][] = [];
    const event: OpenClawEventEnvelope = {
      sequence: 7,
      type: "thread_created",
      createdAt: 123,
      threadId: "thread-1",
      thread: {
        id: "thread-1",
        status: "active",
        targetAgent: "default",
        title: "Thread",
        unreadCount: 0,
        createdAt: 123,
        updatedAt: 123,
      },
    };
    const socket = new FakeWebSocket(createAccount().url);
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: async () => undefined,
        writeLastSeenSequence: async (sequence) => {
          writeCalls.push(sequence);
        },
      },
      onEvent: () => {
        observedWriteState.push([...writeCalls]);
      },
      webSocketFactory: () => socket,
    });

    client.start();
    socket.open();
    await flushMicrotasks();
    socket.message(event);
    await flushMicrotasks();

    expect(writeCalls).toEqual([7]);
    expect(observedWriteState).toEqual([[7]]);
  });

  test("dispatches event envelopes to onEvent", async () => {
    const events: OpenClawEventEnvelope[] = [];
    const socket = new FakeWebSocket(createAccount().url);
    const event: OpenClawEventEnvelope = {
      sequence: 99,
      type: "reply_created",
      createdAt: 456,
      threadId: "thread-1",
      messageId: "message-1",
      message: {
        id: "message-1",
        threadId: "thread-1",
        direction: "user_to_openclaw",
        text: "reply",
        links: [],
        deliveryState: "sent",
        createdAt: 456,
        updatedAt: 456,
      },
    };
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: async () => undefined,
        writeLastSeenSequence: async () => undefined,
      },
      onEvent: (received) => {
        events.push(received);
      },
      webSocketFactory: () => socket,
    });

    client.start();
    socket.open();
    await flushMicrotasks();
    socket.message(event);
    await flushMicrotasks();

    expect(events).toEqual([event]);
  });

  test("logs and ignores malformed server messages", async () => {
    const warnings: string[] = [];
    const socket = new FakeWebSocket(createAccount().url);
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: async () => undefined,
        writeLastSeenSequence: async () => undefined,
      },
      logger: {
        warn: (message) => {
          warnings.push(message);
        },
      },
      onEvent: () => {
        throw new Error("onEvent should not run");
      },
      webSocketFactory: () => socket,
    });

    client.start();
    socket.open();
    await flushMicrotasks();

    socket.messageRaw("{not json");
    socket.message({
      type: "ack",
      requestId: "",
    });
    await flushMicrotasks();

    expect(warnings).toHaveLength(2);
  });

  test("reconnects after close with bounded backoff", async () => {
    const sockets: FakeWebSocket[] = [];
    const timers = new FakeTimers();
    const client = new CowtailRealtimeClient({
      account: createAccount({
        reconnectMinDelayMs: 100,
        reconnectMaxDelayMs: 250,
      }),
      stateStore: {
        readLastSeenSequence: async () => undefined,
        writeLastSeenSequence: async () => undefined,
      },
      onEvent: () => undefined,
      timers,
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    client.start();
    sockets[0]!.open();
    await flushMicrotasks();

    sockets[0]!.close(1006, "dropped");
    expect(timers.scheduled.map((entry) => entry.delay)).toEqual([100]);
    timers.runNext();
    expect(sockets).toHaveLength(2);

    sockets[1]!.open();
    await flushMicrotasks();
    sockets[1]!.close(1006, "dropped again");
    expect(timers.scheduled.map((entry) => entry.delay)).toEqual([100, 200]);
    timers.runNext();
    expect(sockets).toHaveLength(3);

    sockets[2]!.open();
    await flushMicrotasks();
    sockets[2]!.close(1006, "dropped third");
    expect(timers.scheduled.map((entry) => entry.delay)).toEqual([100, 200, 250]);
  });

  test("clears pending requests on close", async () => {
    const socket = new FakeWebSocket(createAccount().url);
    const client = new CowtailRealtimeClient({
      account: createAccount(),
      stateStore: {
        readLastSeenSequence: async () => undefined,
        writeLastSeenSequence: async () => undefined,
      },
      onEvent: () => undefined,
      requestIdFactory: () => "request-2",
      webSocketFactory: () => socket,
    });

    client.start();
    socket.open();
    await flushMicrotasks();

    const pending = client.sendSessionBound({
      type: "openclaw_session_bound",
      threadId: "thread-1",
      sessionKey: "session-1",
    });

    await flushMicrotasks();
    socket.close(1006, "lost connection");

    await expect(pending).rejects.toThrow(/closed/i);
  });
});
