import { vi } from "vitest";

export type StubReply = { status: number; body: unknown };

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

function isReply(value: unknown): value is StubReply {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).sort().join() === "body,status" &&
    typeof (value as StubReply).status === "number"
  );
}

// Replaces `fetch` until the test ends. Keys are "METHOD /path", with the query string when the
// page sends one; a value is the JSON body of a 200, or a `{ status, body }` pair.
export function stubApi(routes: Record<string, unknown>) {
  const calls: ApiCall[] = [];

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), window.location.href);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const path = url.pathname + url.search;
    const raw = init?.body != null ? String(init.body) : await request?.clone().text();
    calls.push({ method, path, body: raw ? JSON.parse(raw) : undefined });

    const key = `${method} ${path}`;
    const route = routes[key];
    const reply: StubReply =
      route === undefined
        ? { status: 404, body: { error: `No stub for ${key}` } }
        : isReply(route)
          ? route
          : { status: 200, body: route };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });

  return { calls };
}
