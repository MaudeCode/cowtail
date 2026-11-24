import {
  authLogoutResponseSchema,
  authProvidersResponseSchema,
  healthResponseSchema,
  hermesStatusResponseSchema,
  itemGetResponseSchema,
  itemInboxResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  itemSourcesResponseSchema,
  itemStatsResponseSchema,
  notificationPreferencesResponseSchema,
  snoozeOptionsResponseSchema,
  type ItemActionRequest,
  type ItemInboxResponse,
  type NotificationPreferences,
  type NotificationPreferencesUpdateRequest,
} from "@maudecode/cowtail-protocol";
import {
  type QueryClient,
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useMutationState,
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

export const hermesStatusQuery = queryOptions({
  queryKey: ["hermes"],
  queryFn: () => api("/api/hermes/status", hermesStatusResponseSchema),
  refetchInterval: LIVE_REFRESH_MS,
});

export const sourcesQuery = queryOptions({
  queryKey: ["sources"],
  queryFn: async () => (await api("/api/items/sources", itemSourcesResponseSchema)).sources,
});

// The snooze picker's preset times, from the server, in this browser's time zone.
export const snoozeOptionsQuery = () => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return queryOptions({
    queryKey: ["snoozeOptions", timeZone],
    queryFn: async () =>
      (
        await api(
          `/api/me/snooze-options?timeZone=${encodeURIComponent(timeZone)}`,
          snoozeOptionsResponseSchema,
        )
      ).options,
    staleTime: 0,
  });
};

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

// The owner's snooze or unsnooze, shown at once: the item moves into Upcoming at its return
// time, or back to the section the server said it returns to. Undefined when the inbox does
// not list the item.
export function showSnoozeInInbox(
  inbox: ItemInboxResponse,
  itemId: string,
  action: Extract<ItemActionRequest, { type: "snooze" | "unsnooze" }>,
): ItemInboxResponse | undefined {
  const item = [...inbox.needsYou, ...inbox.withHermes, ...(inbox.upcoming ?? [])].find(
    (entry) => entry.id === itemId,
  );
  if (!item) return undefined;
  const without = (items: ItemInboxResponse["needsYou"] = []) =>
    items.filter((entry) => entry.id !== itemId);
  const needsYou = without(inbox.needsYou);
  const withHermes = without(inbox.withHermes);
  const upcoming = without(inbox.upcoming);
  if (action.type === "snooze") {
    const at = upcoming.findIndex((entry) => (entry.snoozedUntil ?? Infinity) > action.until);
    upcoming.splice(at === -1 ? upcoming.length : at, 0, {
      ...item,
      state: "snoozed",
      needsOwner: false,
      needsOwnerWhenOpen: item.needsOwner,
      snoozedUntil: action.until,
    });
  } else {
    const needsOwner = item.needsOwnerWhenOpen ?? false;
    const opened = { ...item, state: "open" as const, needsOwner, snoozedUntil: undefined };
    (needsOwner ? needsYou : withHermes).unshift(opened);
  }
  const moved = (before: unknown[] = [], after: unknown[]) => after.length - before.length;
  return {
    ...inbox,
    counts: {
      ...inbox.counts,
      needsYou: inbox.counts.needsYou + moved(inbox.needsYou, needsYou),
      withHermes: inbox.counts.withHermes + moved(inbox.withHermes, withHermes),
      upcoming: (inbox.counts.upcoming ?? 0) + moved(inbox.upcoming, upcoming),
    },
    needsYou,
    withHermes,
    upcoming,
  };
}

const itemActionKey = (itemId: string) => ["itemAction", itemId];

// The owner acts on an item. A snooze or unsnooze shows its result at once; a refusal puts
// the inbox back, and any other failure waits for the reread below to show what the server
// kept. Every other result (the item's new state and where it lists) is the server's to
// decide, so the control that started it shows busy until the reply.
export function useItemAction(itemId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: itemActionKey(itemId),
    mutationFn: (action: ItemActionRequest) =>
      api(`/api/me/items/${encodeURIComponent(itemId)}/actions`, itemResponseSchema, {
        method: "POST",
        body: action,
      }),
    onMutate: async (action) => {
      if (action.type !== "snooze" && action.type !== "unsnooze") return undefined;
      await client.cancelQueries({ queryKey: inboxQuery.queryKey });
      const before = client.getQueryData(inboxQuery.queryKey);
      const shown = before && showSnoozeInInbox(before, itemId, action);
      if (shown) client.setQueryData(inboxQuery.queryKey, shown);
      return { before };
    },
    onError: (error, _action, context) => {
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (refused && context?.before) client.setQueryData(inboxQuery.queryKey, context.before);
    },
    onSettled: () =>
      Promise.all(
        [["inbox"], ["item", itemId], ["items"], ["stats"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

// The newest action on the item, if it failed. It outlives the row that sent it, which a
// snooze or unsnooze moves to another section.
export function useItemActionError(itemId: string): unknown {
  const states = useMutationState({
    filters: { mutationKey: itemActionKey(itemId) },
    select: (mutation) => mutation.state,
  });
  const latest = states.at(-1);
  return latest?.status === "error" ? latest.error : null;
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
