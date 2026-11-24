import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

// nginx serves the Convex HTTP actions under /actions on the web origin, so the session
// cookie rides along with every same-origin request.
const API_BASE = "/actions";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PUT";

// A protocol schema: every reply is checked against the contract before a page reads it.
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export async function api<T>(
  path: string,
  schema: Schema<T>,
  { method = "GET", body }: { method?: Method; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: unknown } | null)?.error;
    throw new ApiError(
      response.status,
      typeof error === "string" ? error : `Request failed: ${response.status}`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError(response.status, "The server sent an unexpected reply");
  return parsed.data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export const SESSION_KEY = ["session"] as const;

// Any 401 means the session is gone: the app falls back to the login page.
export function createQueryClient({ retry = true }: { retry?: boolean } = {}) {
  const signOut = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) client.setQueryData(SESSION_KEY, null);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: signOut }),
    mutationCache: new MutationCache({ onError: signOut }),
    defaultOptions: {
      queries: {
        retry: retry
          ? (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2
          : false,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
