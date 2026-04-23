import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";
import type { OpenClawRealtimeServerMessage } from "@maudecode/cowtail-protocol";

import type { RealtimeClient } from "./auth";

export type RealtimeSocket = {
  readyState: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

type ConnectionEntry = {
  socket: RealtimeSocket;
  client: RealtimeClient;
};

const OPEN_SOCKET_STATE = 1;
export class RealtimeConnectionRegistry {
  #connections = new Map<string, ConnectionEntry>();

  get size(): number {
    return this.#connections.size;
  }

  add(connectionId: string, socket: RealtimeSocket, client: RealtimeClient): void {
    this.#connections.set(connectionId, { socket, client });
  }

  remove(connectionId: string): void {
    this.#connections.delete(connectionId);
  }

  getClient(connectionId: string): RealtimeClient | undefined {
    return this.#connections.get(connectionId)?.client;
  }

  send(connectionId: string, value: OpenClawRealtimeServerMessage): boolean {
    const entry = this.#connections.get(connectionId);
    if (!entry) {
      return false;
    }

    return this.#sendEntry(connectionId, entry, JSON.stringify(value));
  }

  broadcastToIos(event: OpenClawEventEnvelope): number {
    return this.#broadcast((client) => client.kind === "ios", event);
  }

  broadcastToOpenClaw(event: OpenClawEventEnvelope): number {
    return this.#broadcast((client) => client.kind === "openclaw_plugin", event);
  }

  #broadcast(predicate: (client: RealtimeClient) => boolean, event: OpenClawEventEnvelope): number {
    const message = JSON.stringify(event);
    let deliveries = 0;

    for (const [connectionId, entry] of this.#connections) {
      if (!predicate(entry.client)) {
        continue;
      }

      if (entry.socket.readyState !== OPEN_SOCKET_STATE) {
        this.#connections.delete(connectionId);
        continue;
      }

      if (this.#sendEntry(connectionId, entry, message)) {
        deliveries += 1;
      }
    }

    return deliveries;
  }

  #sendEntry(connectionId: string, entry: ConnectionEntry, message: string): boolean {
    if (entry.socket.readyState !== OPEN_SOCKET_STATE) {
      this.#connections.delete(connectionId);
      return false;
    }

    try {
      entry.socket.send(message);
      return true;
    } catch {
      this.#connections.delete(connectionId);
      return false;
    }
  }
}
