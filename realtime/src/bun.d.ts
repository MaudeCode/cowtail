declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T>(value: T): {
    toEqual: (value: T) => void;
    toBe: (value: T) => void;
    toThrow: (message?: string) => void;
  };
}

type BunWebSocket<T = unknown> = {
  data?: T;
};

type BunServeOptions = {
  port?: number;
  fetch?: (
    request: Request,
    server: { upgrade: (request: Request, options?: { data?: unknown }) => boolean },
  ) => Response | Promise<Response>;
  websocket?: {
    open?: (ws: BunWebSocket) => void | Promise<void>;
    message?: (
      ws: BunWebSocket,
      message: string | ArrayBuffer | Uint8Array,
    ) => void | Promise<void>;
    close?: (ws: BunWebSocket, code: number, reason: string) => void | Promise<void>;
  };
};

declare const Bun: {
  env: Record<string, string | undefined>;
  serve(options: BunServeOptions): { stop(): void };
};
