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
  data: T;
  readyState: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

type BunServeOptions<Data> = {
  port?: number;
  fetch?: (
    request: Request,
    server: { upgrade: (request: Request, options?: { data: Data }) => boolean },
  ) => Response | Promise<Response> | void;
  websocket?: {
    open?: (ws: BunWebSocket<Data>) => void | Promise<void>;
    message?: (
      ws: BunWebSocket<Data>,
      message: string | ArrayBuffer | Uint8Array,
    ) => void | Promise<void>;
    close?: (ws: BunWebSocket<Data>, code: number, reason: string) => void | Promise<void>;
  };
};

declare const Bun: {
  env: Record<string, string | undefined>;
  serve<Data>(options: BunServeOptions<Data>): { port: number; stop(): void };
};
