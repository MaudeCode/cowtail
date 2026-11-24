import {
  authLogoutResponseSchema,
  authProvidersResponseSchema,
  healthResponseSchema,
  itemGetResponseSchema,
  itemInboxResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  itemSourcesResponseSchema,
  itemStatsResponseSchema,
  notificationPreferencesResponseSchema,
  type ItemActionRequest,
  type NotificationPreferences,
  type NotificationPreferencesUpdateRequest,
} from "@maudecode/cowtail-protocol";
import {
  type QueryClient,
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { api, ApiError, SESSION_KEY } from "./api";

// Inbox, Home, Cluster, History's stats and an item's page show what is happening now.
const LIVE_REFRESH_MS = 15_000;
const HISTORY_PAGE_SIZE = 100;

export type Session = {
  preferences: NotificationPreferences;
  // The server's order for the urgency override keys.
  urgencyOverrideOrder: string[];
};

// The signed-in account's notification preferences double as the session check: `null` is
// signed out.
export const sessionQuery = queryOptions({
  queryKey: SESSION_KEY,
  queryFn: async (): Promise<Session | null> => {
    try {
      const reply = await api(
        "/api/me/notification-preferences",
        notificationPreferencesResponseSchema,
      );
      return {
        preferences: reply.preferences,
        urgencyOverrideOrder: reply.urgencyOverrideOrder ?? [],
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
});

export const providersQuery = queryOptions({
  queryKey: ["providers"],
  queryFn: () => api("/api/auth/providers", authProvidersResponseSchema),
  staleTime: Infinity,
});

export const inboxQuery = queryOptions({
  queryKey: ["inbox"],
  queryFn: () => api("/api/items/inbox", itemInboxResponseSchema),
  refetchInterval: LIVE_REFRESH_MS,
});

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: () => api("/api/health", healthResponseSchema),
  refetchInterval: LIVE_REFRESH_MS,
});

export const sourcesQuery = queryOptions({
  queryKey: ["sources"],
  queryFn: async () => (await api("/api/items/sources", itemSourcesResponseSchema)).sources,
});

// An open item's page follows Hermes and the producer as they post to its timeline.
export const itemQuery = (id: string) =>
  queryOptions({
    queryKey: ["item", id],
    queryFn: () => api(`/api/items/${encodeURIComponent(id)}`, itemGetResponseSchema),
    refetchInterval: LIVE_REFRESH_MS,
  });

function search(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export type ItemFilter = {
  q?: string;
  source?: string;
  kind?: string;
  outcome?: string;
  from?: number;
  to?: number;
};

export const statsQuery = ({ q: _q, ...filter }: ItemFilter = {}) =>
  queryOptions({
    queryKey: ["stats", filter],
    queryFn: () => api(`/api/items/stats${search(filter)}`, itemStatsResponseSchema),
    refetchInterval: LIVE_REFRESH_MS,
  });

export const itemsQuery = (filter: ItemFilter) =>
  infiniteQueryOptions({
    queryKey: ["items", filter],
    queryFn: ({ pageParam }) =>
      api(
        `/api/items${search({ ...filter, limit: HISTORY_PAGE_SIZE, cursor: pageParam })}`,
        itemListResponseSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
  });

// The owner acts on an item. Its result (the item's new state and where it lists) is the
// server's to decide, so the control that started it shows busy until the reply.
export function useItemAction(itemId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: ItemActionRequest) =>
      api(`/api/me/items/${encodeURIComponent(itemId)}/actions`, itemResponseSchema, {
        method: "POST",
        body: action,
      }),
    onSettled: () =>
      Promise.all(
        [["inbox"], ["item", itemId], ["items"], ["stats"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

// Preference writes in flight, per query client.
const writesInFlight = new WeakMap<QueryClient, number>();

// The owner's own settings show at once. Once the last write in flight settles, the page
// rereads the server: a refused write falls back to the confirmed value, a write whose
// reply was lost shows what the server stored, and replies arriving out of order cannot
// leave an older state on screen.
export function usePreferencesUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationPreferencesUpdateRequest) =>
      api("/api/me/notification-preferences", notificationPreferencesResponseSchema, {
        method: "PUT",
        body: patch,
      }),
    onMutate: async (patch) => {
      writesInFlight.set(client, (writesInFlight.get(client) ?? 0) + 1);
      await client.cancelQueries({ queryKey: SESSION_KEY });
      client.setQueryData(sessionQuery.queryKey, (shown) =>
        shown ? { ...shown, preferences: { ...shown.preferences, ...patch } } : shown,
      );
    },
    onSettled: () => {
      const left = (writesInFlight.get(client) ?? 1) - 1;
      writesInFlight.set(client, left);
      return left === 0 ? client.invalidateQueries({ queryKey: SESSION_KEY }) : undefined;
    },
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/auth/logout", authLogoutResponseSchema, { method: "POST" }),
    onSuccess: () => {
      client.setQueryData(sessionQuery.queryKey, null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    },
  });
}
