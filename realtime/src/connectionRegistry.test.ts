import { describe, expect, test } from "bun:test";

import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import { RealtimeConnectionRegistry } from "./connectionRegistry";
import type { RealtimeClient } from "./auth";

class FakeSocket {
  public readonly sentMessages: string[] = [];
  public readyState = 1;
  public closeCalls: Array<{ code?: number; reason?: string }> = [];
  public throwOnSend = false;

  send(message: string) {
    if (this.throwOnSend) {
      throw new Error("send failed");
    }

    this.sentMessages.push(message);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closeCalls.push({ code, reason });
  }
}

function createEvent(sequence: number): OpenClawEventEnvelope {
  return {
    sequence,
    type: "hello_acknowledged",
    createdAt: 1,
  };
}

function createAckMessage() {
  return {
    type: "ack",
    requestId: "request-1",
    sequence: 1,
  } as const;
}

describe("RealtimeConnectionRegistry", () => {
  test("broadcastToIos sends only to iOS clients and returns delivery count", () => {
    const registry = new RealtimeConnectionRegistry();
    const iosSocket = new FakeSocket();
    const pluginSocket = new FakeSocket();

    registry.add("ios-1", iosSocket, { kind: "ios", userId: "user-1" } satisfies RealtimeClient);
    registry.add("plugin-1", pluginSocket, { kind: "openclaw_plugin" } satisfies RealtimeClient);

    expect(registry.broadcastToIos(createEvent(1))).toBe(1);
    expect(iosSocket.sentMessages).toEqual([JSON.stringify(createEvent(1))]);
    expect(pluginSocket.sentMessages).toEqual([]);
  });

  test("broadcastToOpenClaw sends only to OpenClaw plugin clients and returns delivery count", () => {
    const registry = new RealtimeConnectionRegistry();
    const iosSocket = new FakeSocket();
    const pluginSocket = new FakeSocket();

    registry.add("ios-1", iosSocket, { kind: "ios", userId: "user-1" } satisfies RealtimeClient);
    registry.add("plugin-1", pluginSocket, { kind: "openclaw_plugin" } satisfies RealtimeClient);

    expect(registry.broadcastToOpenClaw(createEvent(2))).toBe(1);
    expect(pluginSocket.sentMessages).toEqual([JSON.stringify(createEvent(2))]);
    expect(iosSocket.sentMessages).toEqual([]);
  });

  test("closed sockets are removed during broadcast and not sent to", () => {
    const registry = new RealtimeConnectionRegistry();
    const closedSocket = new FakeSocket();
    closedSocket.readyState = 3;
    const openSocket = new FakeSocket();

    registry.add("closed", closedSocket, {
      kind: "ios",
      userId: "user-1",
    } satisfies RealtimeClient);
    registry.add("open", openSocket, { kind: "ios", userId: "user-2" } satisfies RealtimeClient);

    expect(registry.broadcastToIos(createEvent(3))).toBe(1);
    expect(closedSocket.sentMessages).toEqual([]);
    expect(openSocket.sentMessages).toEqual([JSON.stringify(createEvent(3))]);
    expect(registry.size).toBe(1);
    expect(registry.getClient("closed")).toBe(undefined);
  });

  test("send removes connections when socket.send fails", () => {
    const registry = new RealtimeConnectionRegistry();
    const socket = new FakeSocket();
    socket.throwOnSend = true;

    registry.add("failing", socket, { kind: "ios", userId: "user-1" } satisfies RealtimeClient);

    expect(registry.send("failing", createAckMessage())).toBe(false);
    expect(registry.size).toBe(0);
    expect(socket.sentMessages).toEqual([]);
  });

  test("broadcast removes failing sockets and does not count them as delivered", () => {
    const registry = new RealtimeConnectionRegistry();
    const failingSocket = new FakeSocket();
    failingSocket.throwOnSend = true;
    const healthySocket = new FakeSocket();

    registry.add("failing", failingSocket, {
      kind: "openclaw_plugin",
    } satisfies RealtimeClient);
    registry.add("healthy", healthySocket, {
      kind: "openclaw_plugin",
    } satisfies RealtimeClient);

    expect(registry.broadcastToOpenClaw(createEvent(4))).toBe(1);
    expect(failingSocket.sentMessages).toEqual([]);
    expect(healthySocket.sentMessages).toEqual([JSON.stringify(createEvent(4))]);
    expect(registry.size).toBe(1);
    expect(registry.getClient("failing")).toBe(undefined);
  });
});
