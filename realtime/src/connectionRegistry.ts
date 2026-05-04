import type {
  OpenClawEventEnvelope,
  OpenClawMessageStreamSnapshotServerMessage,
  OpenClawRealtimeServerMessage,
} from "@maudecode/cowtail-protocol";

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

type IosRealtimeBroadcastMessage =
  | OpenClawEventEnvelope
  | OpenClawMessageStreamSnapshotServerMessage;

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

  broadcastToIos(message: IosRealtimeBroadcastMessage): number {
    return this.#broadcast((client) => client.kind === "ios", message);
  }

  broadcastToOpenClaw(event: OpenClawEventEnvelope): number {
    return this.#broadcast((client) => client.kind === "openclaw_plugin", event);
  }

  #broadcast(
    predicate: (client: RealtimeClient) => boolean,
    value: OpenClawRealtimeServerMessage,
  ): number {
    const message = JSON.stringify(value);
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
