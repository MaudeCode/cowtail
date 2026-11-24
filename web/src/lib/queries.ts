import {
  authLogoutResponseSchema,
  authProvidersResponseSchema,
  healthResponseSchema,
  hermesStatusResponseSchema,
  itemGetResponseSchema,
  itemGraphResponseSchema,
  itemInboxResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  itemSourcesResponseSchema,
  itemStatsResponseSchema,
  maintenanceWindowListResponseSchema,
  maintenanceWindowResponseSchema,
  notificationPreferencesResponseSchema,
  runbookRunGetResponseSchema,
  runbookRunResponseSchema,
  snoozeOptionsResponseSchema,
  type ItemActionRequest,
  type ItemInboxResponse,
  type ItemGraphRange,
  type MaintenanceWindowListResponse,
  type MaintenanceWindowStartRequest,
  type NotificationPreferences,
  type NotificationPreferencesUpdateRequest,
  type RunbookRunRequest,
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
// A runbook run's output, while the run is queued or running.
const RUN_REFRESH_MS = 1_000;

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

// A poll or refocus that reads the inbox while a snooze or unsnooze is on its way shows that
// write still applied, so the item cannot jump back before the server answers.
export const inboxQuery = queryOptions({
  queryKey: ["inbox"],
  queryFn: async ({ client }) =>
    withPendingSnoozes(client, await api("/api/items/inbox", itemInboxResponseSchema)),
  refetchInterval: LIVE_REFRESH_MS,
});

type SnoozeAction = Extract<ItemActionRequest, { type: "snooze" | "unsnooze" }>;
type PendingSnooze = { itemId: string; action: SnoozeAction };

// Snoozes and unsnoozes sent and not yet answered, per query client, oldest first.
const pendingSnoozes = new WeakMap<QueryClient, Set<PendingSnooze>>();

function withPendingSnoozes(client: QueryClient, inbox: ItemInboxResponse) {
  let shown = inbox;
  for (const { itemId, action } of pendingSnoozes.get(client) ?? []) {
    shown = showSnoozeInInbox(shown, itemId, action) ?? shown;
  }
  return shown;
}

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

const MAINTENANCE_PATH = "/api/me/maintenance-windows";

// Windows the owner ended and the server has not yet answered, per query client: a poll that
// reads the list before the reply keeps them gone.
const pendingEnds = new WeakMap<QueryClient, Set<string>>();

function withoutWindows(list: MaintenanceWindowListResponse, ids: Set<string> | undefined) {
  if (!ids?.size) return list;
  return { ...list, active: list.active.filter((window) => !ids.has(window.id)) };
}

export const maintenanceQuery = queryOptions({
  queryKey: ["maintenance"],
  queryFn: async ({ client }) =>
    withoutWindows(
      await api(MAINTENANCE_PATH, maintenanceWindowListResponseSchema),
      pendingEnds.get(client),
    ),
  refetchInterval: LIVE_REFRESH_MS,
});

// The server starts the window and silences Alertmanager, so the sheet's submit shows busy
// until the reply, which lists the window at once.
export function useStartMaintenance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: MaintenanceWindowStartRequest) =>
      api(MAINTENANCE_PATH, maintenanceWindowResponseSchema, { method: "POST", body: request }),
    onSuccess: ({ window }) =>
      client.setQueryData(maintenanceQuery.queryKey, (shown) =>
        shown
          ? {
              ...shown,
              active: [...shown.active.filter((entry) => entry.id !== window.id), window].sort(
                (a, b) => a.endsAt - b.endsAt,
              ),
            }
          : shown,
      ),
    onSettled: () => client.invalidateQueries({ queryKey: maintenanceQuery.queryKey }),
  });
}

// Ending a window shows at once: its banner goes, and comes back if the server refuses. Any
// other failure waits for the reread to show what the server kept.
export function useEndMaintenance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`${MAINTENANCE_PATH}/${encodeURIComponent(id)}/end`, maintenanceWindowResponseSchema, {
        method: "POST",
      }),
    onMutate: async (id) => {
      const ending = pendingEnds.get(client) ?? new Set<string>();
      pendingEnds.set(client, ending.add(id));
      await client.cancelQueries({ queryKey: maintenanceQuery.queryKey });
      const before = client.getQueryData(maintenanceQuery.queryKey);
      if (before) {
        client.setQueryData(maintenanceQuery.queryKey, withoutWindows(before, new Set([id])));
      }
      return { before };
    },
    onError: (error, id, context) => {
      const window = context?.before?.active.find((entry) => entry.id === id);
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (!refused || !window) return;
      client.setQueryData(maintenanceQuery.queryKey, (shown) =>
        shown && !shown.active.some((entry) => entry.id === id)
          ? { ...shown, active: [...shown.active, window].sort((a, b) => a.endsAt - b.endsAt) }
          : shown,
      );
    },
    onSettled: (_reply, _error, id) => {
      pendingEnds.get(client)?.delete(id);
      return client.invalidateQueries({ queryKey: maintenanceQuery.queryKey });
    },
  });
}

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

// A run and its output, followed every second until the run ends.
export const runbookRunQuery = (id: string) =>
  queryOptions({
    queryKey: ["runbookRun", id],
    queryFn: () =>
      api(`/api/me/runbook/runs/${encodeURIComponent(id)}`, runbookRunGetResponseSchema),
    refetchInterval: (query) => (query.state.data?.run.active === false ? false : RUN_REFRESH_MS),
  });

// Run requests the server never answered, per query client, by script and item. The next tap
// sends the same request again, so the server returns the run it may have queued and queues no
// second one.
const unansweredRuns = new WeakMap<QueryClient, Map<string, string>>();

// The owner starts a runbook run. The run is the server's to create, so only the control that
// started it shows busy; Hermes, and the item the run is for, reread once it settles.
export function useRunbookRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (request: Omit<RunbookRunRequest, "requestId">) => {
      const unanswered = unansweredRuns.get(client) ?? new Map<string, string>();
      unansweredRuns.set(client, unanswered);
      const key = `${request.scriptId}\n${request.itemId ?? ""}`;
      const requestId = unanswered.get(key) ?? crypto.randomUUID();
      unanswered.set(key, requestId);
      try {
        const reply = await api("/api/me/runbook/runs", runbookRunResponseSchema, {
          method: "POST",
          body: { requestId, ...request },
        });
        unanswered.delete(key);
        return reply;
      } catch (error) {
        // A refusal is the server's answer; anything else leaves the outcome unknown.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          unanswered.delete(key);
        }
        throw error;
      }
    },
    onSettled: (_reply, _error, request) =>
      Promise.all(
        [["hermes"], ...(request.itemId ? [["item", request.itemId], ...lists] : [])].map(
          (queryKey) => client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

// An open item's page follows Hermes and the producer as they post to its timeline.
export const itemQuery = (id: string) =>
  queryOptions({
    queryKey: ["item", id],
    queryFn: () => api(`/api/items/${encodeURIComponent(id)}`, itemGetResponseSchema),
    refetchInterval: LIVE_REFRESH_MS,
  });

// The alert's metric over the chosen range, refreshed with the page.
export const itemGraphQuery = (id: string, range: ItemGraphRange) =>
  queryOptions({
    queryKey: ["item", id, "graph", range],
    queryFn: () =>
      api(`/api/items/${encodeURIComponent(id)}/graph?range=${range}`, itemGraphResponseSchema),
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

type InboxSection = "needsYou" | "withHermes" | "upcoming";
const inboxSections: InboxSection[] = ["needsYou", "withHermes", "upcoming"];
type Sections = Record<InboxSection, ItemInboxResponse["needsYou"]>;

// The inbox with new section lists, its counts moved by as many items as each list moved.
function withSections(inbox: ItemInboxResponse, sections: Sections): ItemInboxResponse {
  const moved = (section: InboxSection) => sections[section].length - (inbox[section] ?? []).length;
  return {
    ...inbox,
    ...sections,
    counts: {
      ...inbox.counts,
      needsYou: inbox.counts.needsYou + moved("needsYou"),
      withHermes: inbox.counts.withHermes + moved("withHermes"),
      upcoming: (inbox.counts.upcoming ?? 0) + moved("upcoming"),
    },
  };
}

function sectionsWithout(inbox: ItemInboxResponse, itemId: string): Sections {
  const without = (section: InboxSection) =>
    (inbox[section] ?? []).filter((entry) => entry.id !== itemId);
  return {
    needsYou: without("needsYou"),
    withHermes: without("withHermes"),
    upcoming: without("upcoming"),
  };
}

// The owner's snooze or unsnooze, shown at once: the item moves into Upcoming at its return
// time, or back to the section the server said it returns to. Undefined when the inbox does
// not list the item, or already shows the write's result: a poll can read the server's result
// before the reply, and that result keeps the server's own fields.
export function showSnoozeInInbox(
  inbox: ItemInboxResponse,
  itemId: string,
  action: SnoozeAction,
): ItemInboxResponse | undefined {
  const item = inboxSections
    .flatMap((section) => inbox[section] ?? [])
    .find((entry) => entry.id === itemId);
  if (!item) return undefined;
  const applied =
    action.type === "snooze"
      ? item.state === "snoozed" && item.snoozedUntil === action.until
      : item.state !== "snoozed";
  if (applied) return undefined;
  const sections = sectionsWithout(inbox, itemId);
  if (action.type === "snooze") {
    const { upcoming } = sections;
    const at = upcoming.findIndex((entry) => (entry.snoozedUntil ?? Infinity) > action.until);
    upcoming.splice(at === -1 ? upcoming.length : at, 0, {
      ...item,
      state: "snoozed",
      needsOwner: false,
      // Snoozed already, the server's answer stands.
      needsOwnerWhenOpen: item.state === "snoozed" ? item.needsOwnerWhenOpen : item.needsOwner,
      snoozedUntil: action.until,
    });
  } else {
    const needsOwner = item.needsOwnerWhenOpen ?? false;
    const opened = { ...item, state: "open" as const, needsOwner, snoozedUntil: undefined };
    sections[needsOwner ? "needsYou" : "withHermes"].unshift(opened);
  }
  return withSections(inbox, sections);
}

// One refused item back where it was before the write, leaving every other item as it is now.
export function restoreItemInInbox(
  inbox: ItemInboxResponse,
  before: ItemInboxResponse,
  itemId: string,
): ItemInboxResponse {
  const sections = sectionsWithout(inbox, itemId);
  for (const section of inboxSections) {
    const list = before[section] ?? [];
    const index = list.findIndex((entry) => entry.id === itemId);
    if (index !== -1) sections[section].splice(index, 0, list[index]);
  }
  return withSections(inbox, sections);
}

const itemActionKey = (itemId: string) => ["itemAction", itemId];
const lists = [["inbox"], ["items"], ["stats"]];

// Writes in flight, per query client and kind of write.
const writesInFlight = new WeakMap<QueryClient, Map<string, number>>();

function startWrite(client: QueryClient, kind: string) {
  const counts = writesInFlight.get(client) ?? new Map<string, number>();
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  writesInFlight.set(client, counts);
}

// True when this was the last write of its kind in flight.
function lastWriteSettled(client: QueryClient, kind: string) {
  const counts = writesInFlight.get(client);
  const left = (counts?.get(kind) ?? 1) - 1;
  counts?.set(kind, left);
  return left === 0;
}

// The owner acts on an item. A snooze or unsnooze shows its result at once; a refusal puts
// that item back, and any other failure waits for the reread to show what the server kept.
// The lists are reread once the last item action in flight settles, so a reply cannot pull
// back another item whose write is still on its way. Every other result (the item's new
// state and where it lists) is the server's to decide, so the control that started it shows
// busy until the reply.
export function useItemAction(itemId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: itemActionKey(itemId),
    // One item's actions go to the server one at a time, each shown at once, so an older
    // reply can never land after a newer one.
    scope: { id: `item-${itemId}` },
    mutationFn: (action: ItemActionRequest) =>
      api(`/api/me/items/${encodeURIComponent(itemId)}/actions`, itemResponseSchema, {
        method: "POST",
        body: action,
      }),
    onMutate: async (action) => {
      startWrite(client, "itemAction");
      if (action.type !== "snooze" && action.type !== "unsnooze") return undefined;
      const pending = { itemId, action };
      const sent = pendingSnoozes.get(client) ?? new Set<PendingSnooze>();
      pendingSnoozes.set(client, sent.add(pending));
      await client.cancelQueries({ queryKey: inboxQuery.queryKey });
      const before = client.getQueryData(inboxQuery.queryKey);
      const shown = before && showSnoozeInInbox(before, itemId, action);
      if (shown) client.setQueryData(inboxQuery.queryKey, shown);
      return { before, pending };
    },
    onSuccess: (_reply, _action, context) => {
      if (context?.pending) pendingSnoozes.get(client)?.delete(context.pending);
    },
    onError: (error, _action, context) => {
      if (context?.pending) pendingSnoozes.get(client)?.delete(context.pending);
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
      const before = context?.before;
      if (refused && before) {
        client.setQueryData(inboxQuery.queryKey, (shown) =>
          shown ? restoreItemInInbox(shown, before, itemId) : shown,
        );
      }
    },
    onSettled: () =>
      Promise.all(
        [["item", itemId], ...(lastWriteSettled(client, "itemAction") ? lists : [])].map(
          (queryKey) => client.invalidateQueries({ queryKey }),
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
      startWrite(client, "preferences");
      await client.cancelQueries({ queryKey: SESSION_KEY });
      client.setQueryData(sessionQuery.queryKey, (shown) =>
        shown ? { ...shown, preferences: { ...shown.preferences, ...patch } } : shown,
      );
    },
    onSettled: () =>
      lastWriteSettled(client, "preferences")
        ? client.invalidateQueries({ queryKey: SESSION_KEY })
        : undefined,
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
