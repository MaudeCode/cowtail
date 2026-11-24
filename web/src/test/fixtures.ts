import type {
  HealthResponse,
  HermesStatusResponse,
  ItemInboxResponse,
  ItemRecord,
  ItemStatsResponse,
  NotificationPreferences,
} from "@maudecode/cowtail-protocol";

// Synthetic replies shaped by the protocol schemas the app parses every reply with.

const MINUTE = 60_000;
export const NOW = Date.now();

export function item(overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: "item-1",
    source: "alertmanager",
    sourceInfo: { slug: "alertmanager", displayName: "Alertmanager" },
    kind: "alert",
    urgency: "now",
    state: "open",
    needsOwner: true,
    title: "KubePodCrashLooping",
    body: "",
    links: [],
    context: {},
    occurrenceCount: 1,
    actions: [],
    availableActions: [],
    createdAt: NOW - 30 * MINUTE,
    updatedAt: NOW - 10 * MINUTE,
    ...overrides,
  };
}

export function inbox(lists: Partial<Omit<ItemInboxResponse, "ok" | "counts">> = {}) {
  const needsYou = lists.needsYou ?? [];
  const withHermes = lists.withHermes ?? [];
  const upcoming = lists.upcoming ?? [];
  const handled = lists.handled ?? [];
  return {
    ok: true,
    counts: {
      needsYou: needsYou.length,
      withHermes: withHermes.length,
      upcoming: upcoming.length,
      handled: handled.length,
    },
    needsYou,
    withHermes,
    upcoming,
    handled,
  };
}

export const health: HealthResponse = {
  nodes: [{ name: "node-1", status: "Ready", cpu: 34, memory: 58 }],
  cephStatus: "HEALTH_OK",
  cephMessage: "All PGs active+clean",
  storageUsed: 14.6,
  storageTotal: 24,
  storageUnit: "TiB",
  readyNodes: 1,
  alertPipeline: { state: "ok", lastWatchdogAt: NOW - 2 * MINUTE },
};

export const stats: ItemStatsResponse = {
  ok: true,
  from: NOW - 7 * 24 * 60 * MINUTE,
  to: NOW,
  timeZone: "America/New_York",
  createdCount: 3,
  resolvedCount: 2,
  outcomeMix: { fixed: 1, "self-resolved": 0, noise: 1, escalated: 0, other: 0 },
  noiseRate: 0.5,
  timeToResolve: [{ kind: "alert", count: 2, medianMs: 14 * MINUTE, p90Ms: 130 * MINUTE }],
  repeatOffenders: [
    {
      dedupeKey: "target-down",
      title: "TargetDown",
      occurrenceCount: 3,
      noiseShare: 0.9,
      lastSeenAt: NOW - MINUTE,
    },
  ],
  dailyVolume: [{ date: "2026-11-23", total: 3, bySource: { alertmanager: 2, hermes: 1 } }],
  volumeSources: ["alertmanager", "hermes"],
  firingCount: 1,
  firingByNamespace: [
    { namespace: "media", count: 1, itemIds: ["item-1"], titles: ["KubePodCrashLooping"] },
  ],
};

export const hermesStatus: HermesStatusResponse = {
  ok: true,
  status: {
    receivedAt: NOW - 38_000,
    heartbeatMissing: false,
    statusLevel: "amber",
    snapshot: {
      platforms: ["cowtail", "telegram"],
      model: "opus-5.5",
      provider: "anthropic",
      cronJobs: [],
      openIncidents: [],
      kanban: { blocked: 2, running: 1 },
      budget: { today: "62%" },
      rateLimits: { anthropic: "ok" },
    },
    // The server's order: failing first.
    cronJobs: [
      {
        id: "job-2",
        name: "backup-verify",
        schedule: "0 3 * * *",
        lastStatus: "error",
        failing: true,
      },
      {
        id: "job-1",
        name: "roundup-digest",
        schedule: "0 8 * * *",
        lastStatus: "ok",
        failing: false,
      },
    ],
    cronJobCount: 2,
    failingCronCount: 1,
    incidentCount: 1,
    kanbanBlocked: true,
    budgetOrder: ["today"],
    rateLimitOrder: ["anthropic"],
    incidents: [
      {
        id: "inc-1",
        jobId: "job-2",
        state: "open",
        jobName: "backup-verify",
        itemId: "item-7",
        itemTitle: "Nightly backup verify failed",
      },
    ],
  },
  recentAnswers: [
    {
      itemId: "item-3",
      title: "Restart ingress in edge?",
      answer: { type: "approve" },
      answeredAt: NOW,
    },
    {
      itemId: "item-4",
      title: "Rebalance now or wait?",
      answer: { type: "choose", option: "Wait" },
      answeredAt: NOW,
    },
    { itemId: "item-5", title: "Delete 14 stale PVCs?", answer: { type: "deny" }, answeredAt: NOW },
  ],
};

export const preferences: NotificationPreferences = {
  dailyRoundupEnabled: true,
  quietHours: null,
  urgencyOverrides: { factory: "whenever" },
  requireAuthForApprovals: true,
};

export const SESSION = "GET /actions/api/me/notification-preferences";

// The routes every signed-in page reads.
export function signedIn(routes: Record<string, unknown> = {}) {
  return {
    [SESSION]: { ok: true, preferences },
    "GET /actions/api/auth/providers": { apple: true, oidc: { name: "Pocket ID" } },
    "GET /actions/api/health": health,
    "GET /actions/api/hermes/status": hermesStatus,
    ...routes,
  };
}
