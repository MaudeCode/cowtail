import {
  itemCreateResponseSchema,
  itemGetResponseSchema,
  maintenanceWindowResponseSchema,
  itemSyncPushDataSchema,
  notificationPreferencesResponseSchema,
} from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type Backend,
  advance,
  newBackendWithSources,
  request,
  rows,
  seedSession,
  stubEnv,
} from "../test/convexHarness";
import { ITEM_SYNC_WINDOW_MS } from "./items";

// The APNs transport is the existing /api/push/send path; these tests watch what reaches it.
const sendPushToUser = vi.hoisted(() =>
  vi.fn(async (_ctx: unknown, args: { userId: string }) => ({
    ok: true,
    userId: args.userId,
    sent: 1,
    failed: 0,
    skipped: 0,
    results: [],
  })),
);
vi.mock("./pushDelivery", () => ({ sendPushToUser }));

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const MINUTE = 60_000;
const SERVICE = "service-token";
const OWNER = "owner-user";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({ PUSH_API_BEARER_TOKEN: SERVICE, COWTAIL_OWNER_USER_ID: OWNER });
  sendPushToUser.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function createItem(t: Backend, body: Record<string, unknown>) {
  const response = await request(t, "/api/items", {
    method: "POST",
    bearer: SERVICE,
    body: { source: "hermes", kind: "fyi", title: "Item", ...body },
  });
  expect(response.status).toBe(200);
  // Runs the delivery the create scheduled. convex-test can set a `runAfter(0)` timer a
  // fraction of a millisecond ahead, which a zero-length advance never fires.
  await advance(t, 1);
  return itemCreateResponseSchema.parse(response.json).id;
}

async function getItem(t: Backend, id: string) {
  const response = await request(t, `/api/items/${id}`, { bearer: SERVICE });
  return itemGetResponseSchema.parse(response.json);
}

async function decisions(t: Backend, id: string) {
  return (await getItem(t, id)).events
    .filter((event) => event.type === "notified")
    .map((event) => event.payload);
}

const sessions = new WeakMap<Backend, Promise<string>>();
function ownerSession(t: Backend) {
  if (!sessions.has(t)) sessions.set(t, seedSession(t, OWNER));
  return sessions.get(t)!;
}

async function setPreferences(t: Backend, preferences: Record<string, unknown>) {
  const response = await request(t, "/api/me/notification-preferences", {
    method: "PUT",
    bearer: await ownerSession(t),
    body: preferences,
  });
  expect(response.status).toBe(200);
  return notificationPreferencesResponseSchema.parse(response.json).preferences;
}

// Background syncs leave through the same sender; alert pushes are the ones the owner sees.
const sent = () => sendPushToUser.mock.calls.map(([, args]) => args as Record<string, unknown>);
const alertPushes = () => sent().filter((args) => args.pushType !== "background");
const syncPushes = () => sent().filter((args) => args.pushType === "background");
const pushTitles = () => alertPushes().map((args) => args.title);

describe("item delivery", () => {
  test("a registered service sends a message once and retries retain its accepted ID", async () => {
    const t = await newBackendWithSources("cron");
    const registration = await request(t, "/api/sources", {
      method: "POST",
      bearer: SERVICE,
      body: { slug: "library", displayName: "Library" },
    });
    const bearer = (registration.json as { token: string }).token;
    const message = "Your hold is ready";
    const send = async (idempotencyKey?: string) => {
      const response = await request(t, "/api/messages", {
        method: "POST",
        bearer,
        body: { message, idempotencyKey },
      });
      expect(response.status).toBe(200);
      return (response.json as { id: string }).id;
    };
    const first = await send("hold-5");
    await advance(t, 1, { only: [] });
    expect(alertPushes()).toEqual([
      expect.objectContaining({
        title: "Library",
        body: message,
        data: expect.objectContaining({ itemId: first }),
        aps: expect.objectContaining({ interruptionLevel: "active" }),
      }),
    ]);
    const acknowledgement = await request(t, `/api/me/items/${first}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "ack" },
    });
    expect(acknowledgement.status).toBe(200);
    expect(await send("hold-5")).toBe(first);
    const second = await send();
    expect(second).not.toBe(first);
    expect((await getItem(t, second)).item).toMatchObject({ body: message, source: "library" });
    await advance(t, 60 * MINUTE, { only: [] });
    expect(pushTitles()).toEqual(["Library", "Library"]);
  });

  test("a now item pushes at once and again every 10 minutes, three more times at most", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "now", title: "Restart ingress in edge?" });
    expect(alertPushes()).toHaveLength(1);
    expect(alertPushes()[0]).toMatchObject({
      userId: OWNER,
      title: "Restart ingress in edge?",
      aps: { interruptionLevel: "time-sensitive" },
    });

    for (let interval = 1; interval <= 6; interval++) {
      await advance(t, 10 * MINUTE, { only: [] });
      expect(alertPushes()).toHaveLength(1 + Math.min(interval, 3));
    }
    expect((await decisions(t, id)).map(({ decision, attempt }) => [decision, attempt])).toEqual([
      ["pushed", 0],
      ["pushed", 1],
      ["pushed", 2],
      ["pushed", 3],
    ]);
  });

  test("acking a now item stops its re-sends", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "now" });
    await advance(t, 10 * MINUTE);
    expect(alertPushes()).toHaveLength(2);

    const ack = await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "ack" },
    });
    expect(ack.status).toBe(200);
    await advance(t, 60 * MINUTE, { only: [] });

    expect(alertPushes()).toHaveLength(2);
    expect((await decisions(t, id)).at(-1)).toMatchObject({
      trigger: "resend",
      decision: "skipped",
      why: "not_open",
    });
  });

  test("today items created within 5 minutes arrive as one push", async () => {
    const t = await newBackendWithSources("cron");
    const ids = [await createItem(t, { urgency: "today", title: "Backup verify failed" })];
    await advance(t, 2 * MINUTE);
    ids.push(await createItem(t, { urgency: "today", title: "Merge queue stalled" }));
    await advance(t, 2 * MINUTE);
    ids.push(await createItem(t, { urgency: "today", title: "Cert renews in 9 days" }));
    expect(alertPushes()).toEqual([]);

    await advance(t, MINUTE);
    expect(alertPushes()).toHaveLength(1);
    expect(alertPushes()[0]).toMatchObject({
      title: "3 new items",
      body: "Backup verify failed, Merge queue stalled, 1 more",
      data: { type: "item_batch", count: 3 },
      aps: { interruptionLevel: "active" },
    });
    for (const id of ids) {
      expect((await decisions(t, id)).map(({ decision }) => decision)).toEqual([
        "batched",
        "pushed",
      ]);
    }

    // The window closed with its push; the next today item opens a new one.
    const late = await createItem(t, { urgency: "today", title: "Late" });
    await advance(t, 5 * MINUTE);
    expect(pushTitles()).toEqual(["3 new items", "Late"]);
    expect((await decisions(t, late)).map(({ decision }) => decision)).toEqual([
      "batched",
      "pushed",
    ]);
  });

  test("a whenever item never pushes", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "whenever" });
    await advance(t, 60 * MINUTE, { only: [] });

    expect(alertPushes()).toEqual([]);
    expect(await decisions(t, id)).toEqual([
      { trigger: "created", attempt: 0, decision: "skipped", why: "whenever" },
    ]);
  });

  test("quiet hours hold today pushes until they end, and never hold now pushes", async () => {
    const t = await newBackendWithSources("cron");
    // NOW is 07:00 in New York; quiet hours run to 07:25.
    await setPreferences(t, {
      quietHours: { start: "22:00", end: "07:25", timeZone: "America/New_York" },
    });

    const today = await createItem(t, { urgency: "today", title: "Held" });
    const now = await createItem(t, { urgency: "now", title: "Urgent" });
    expect(pushTitles()).toEqual(["Urgent"]);

    await advance(t, 5 * MINUTE);
    expect(pushTitles()).toEqual(["Urgent"]);
    expect((await decisions(t, today)).at(-1)).toMatchObject({
      decision: "held",
      why: "quiet_hours",
      until: NOW + 25 * MINUTE,
    });

    await advance(t, 20 * MINUTE);
    expect(pushTitles()).toEqual(["Urgent", "Urgent", "Urgent", "Held"]);
    expect((await decisions(t, now))[0]).toMatchObject({ decision: "pushed", attempt: 0 });
  });

  test("a repeat that raises urgency pushes the item", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "whenever", dedupeKey: "disk:osd-4" });
    expect(await createItem(t, { urgency: "now", dedupeKey: "disk:osd-4" })).toBe(id);

    expect((await getItem(t, id)).item.urgency).toBe("now");
    expect(alertPushes()).toHaveLength(1);
    expect((await decisions(t, id)).map(({ trigger, decision }) => [trigger, decision])).toEqual([
      ["created", "skipped"],
      ["urgency_raised", "pushed"],
    ]);
  });

  test("urgency overrides set the stored urgency when an item is created", async () => {
    const t = await newBackendWithSources("cron");
    await setPreferences(t, { urgencyOverrides: { cron: "whenever", "hermes:question": "now" } });

    const cron = await createItem(t, { source: "cron", kind: "failure", urgency: "now" });
    const question = await createItem(t, { kind: "question", urgency: "whenever" });
    const fyi = await createItem(t, { kind: "fyi", urgency: "today" });

    expect((await getItem(t, cron)).item.urgency).toBe("whenever");
    expect((await getItem(t, question)).item.urgency).toBe("now");
    expect((await getItem(t, fyi)).item.urgency).toBe("today");
  });
});

describe("reminders", () => {
  const states = async (t: Backend, id: string) =>
    (await getItem(t, id)).events
      .filter((event) => event.type === "state_changed")
      .map(({ actor, payload }) => ({ actor, ...payload }));
  const triggers = async (t: Backend, id: string) =>
    (await decisions(t, id)).map(({ trigger, decision }) => [trigger, decision]);

  test("a snoozed item returns to open when its snooze ends and pushes once, at least as today", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "whenever", title: "Check the disk shipment" });
    const snooze = await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "snooze", until: NOW + 60 * MINUTE },
    });
    expect(snooze.status).toBe(200);

    await advance(t, 59 * MINUTE, { only: ["return snoozed items whose time has come"] });
    expect((await getItem(t, id)).item.state).toBe("snoozed");

    await advance(t, 60 * MINUTE, { only: ["return snoozed items whose time has come"] });
    expect((await getItem(t, id)).item.state).toBe("open");
    expect((await states(t, id)).at(-1)).toEqual({
      actor: "cowtail",
      from: "snoozed",
      to: "open",
      reason: "reminder",
    });
    expect(alertPushes()).toHaveLength(1);
    expect(alertPushes()[0]).toMatchObject({
      title: "Check the disk shipment",
      aps: { interruptionLevel: "active" },
    });
    expect(await triggers(t, id)).toEqual([
      ["created", "skipped"],
      ["reminder", "pushed"],
    ]);
  });

  test("a today item snoozed out of its batch pushes only its reminder", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "today", title: "Cert renews in 9 days" });
    await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "snooze", until: NOW + 2 * MINUTE },
    });

    await advance(t, 30 * MINUTE);

    expect(alertPushes()).toHaveLength(1);
    expect((await triggers(t, id)).filter(([, decision]) => decision === "pushed")).toEqual([
      ["reminder", "pushed"],
    ]);
  });

  test("a today item snoozed and unsnoozed by hand before its batch sends pushes nothing", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "today", title: "Cert renews in 9 days" });
    const act = async (body: Record<string, unknown>) =>
      request(t, `/api/me/items/${id}/actions`, {
        method: "POST",
        bearer: await ownerSession(t),
        body,
      });
    await act({ type: "snooze", until: NOW + 60 * MINUTE });
    await advance(t, MINUTE);
    await act({ type: "unsnooze" });

    await advance(t, 30 * MINUTE);

    expect(alertPushes()).toEqual([]);
  });

  test("a now item snoozed between its re-sends pushes its reminder and no older re-send", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "now", title: "Restart ingress in edge?" });
    await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "snooze", until: NOW + 2 * MINUTE },
    });

    await advance(t, 60 * MINUTE, { only: ["return snoozed items whose time has come"] });

    expect((await triggers(t, id)).filter(([, decision]) => decision === "pushed")).toEqual([
      ["created", "pushed"],
      ["reminder", "pushed"],
    ]);
  });

  test("a snoozed item whose deadline passed is left to expire, not returned", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, {
      kind: "question",
      urgency: "today",
      title: "Rebalance now?",
      expiresAt: NOW + 90_000,
    });
    await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "snooze", until: NOW + 60_000 },
    });
    // Both came due since the last tick; the return job runs before the expiry job here.
    vi.setSystemTime(NOW + 100_000);

    await t.mutation(makeFunctionReference<"mutation">("items:returnSnoozedItems"), {});
    await advance(t, 30 * MINUTE);

    expect((await getItem(t, id)).item.state).toBe("expired");
    expect(alertPushes()).toEqual([]);
  });

  test("an item created with a future remindAt sends nothing until then, then returns the same way", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, {
      urgency: "whenever",
      title: "Ping about the renewal",
      remindAt: NOW + 120 * MINUTE,
    });
    expect((await getItem(t, id)).item).toMatchObject({
      state: "snoozed",
      snoozedUntil: NOW + 120 * MINUTE,
    });

    await advance(t, 119 * MINUTE, { only: ["return snoozed items whose time has come"] });
    expect(alertPushes()).toEqual([]);
    expect(await decisions(t, id)).toEqual([]);

    await advance(t, 60 * MINUTE, { only: ["return snoozed items whose time has come"] });
    expect((await states(t, id)).at(-1)).toMatchObject({ to: "open", reason: "reminder" });
    expect(alertPushes()).toHaveLength(1);
    expect(alertPushes()[0]).toMatchObject({
      title: "Ping about the renewal",
      aps: { interruptionLevel: "active" },
    });
    expect(await triggers(t, id)).toEqual([["reminder", "pushed"]]);
  });
});

describe("background sync", () => {
  async function act(t: Backend, id: string, body: Record<string, unknown>) {
    const response = await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body,
    });
    expect(response.status).toBe(200);
  }
  const syncs = () => syncPushes().map((args) => itemSyncPushDataSchema.parse(args.data));

  test("items handled on the web within a few seconds send one background push with the badge left", async () => {
    const t = await newBackendWithSources("cron");
    const approval = (title: string) => createItem(t, { kind: "approval", urgency: "now", title });
    const [first, second, third] = [
      await approval("Restart ingress?"),
      await approval("Drain node-3?"),
      await approval("Rotate the key?"),
    ];

    await act(t, first, { type: "ack" });
    await advance(t, 1_000);
    await act(t, second, { type: "ack" });
    expect(syncPushes()).toEqual([]);

    await advance(t, ITEM_SYNC_WINDOW_MS);
    expect(syncPushes()).toEqual([
      {
        userId: OWNER,
        pushType: "background",
        priority: 5,
        data: { type: "item_sync", badge: 1, itemIds: [first, second] },
      },
    ]);

    // The window closed with its push; the next handled item opens a new one.
    await act(t, third, { type: "ack" });
    await advance(t, ITEM_SYNC_WINDOW_MS);
    expect(syncs().map(({ badge, itemIds }) => [badge, itemIds])).toEqual([
      [1, [first, second]],
      [0, [third]],
    ]);
  });

  test("an item live again before the push sends is left out of it", async () => {
    const t = await newBackendWithSources("cron");
    const back = await createItem(t, { urgency: "today", title: "Snoozed and back" });
    const acked = await createItem(t, { urgency: "today", title: "Acked" });

    await act(t, back, { type: "snooze", until: NOW + 60 * MINUTE });
    await act(t, acked, { type: "ack" });
    await act(t, back, { type: "unsnooze" });
    await advance(t, ITEM_SYNC_WINDOW_MS);

    expect(syncs().map(({ itemIds }) => itemIds)).toEqual([[acked]]);
  });

  test("a batch's items handled in separate windows are named together once none is live", async () => {
    const t = await newBackendWithSources("cron");
    const first = await createItem(t, { urgency: "today", title: "Backup verify failed" });
    const second = await createItem(t, { urgency: "today", title: "Merge queue stalled" });
    await advance(t, 5 * MINUTE);
    expect(alertPushes()[0]).toMatchObject({
      data: { type: "item_batch", itemIds: [first, second] },
    });

    await act(t, first, { type: "ack" });
    await advance(t, ITEM_SYNC_WINDOW_MS);
    await act(t, second, { type: "ack" });
    await advance(t, ITEM_SYNC_WINDOW_MS);

    expect(syncs().map(({ itemIds }) => itemIds.toSorted())).toEqual([
      [first],
      [first, second].toSorted(),
    ]);
  });

  test("an item stops being live once, whether acked, snoozed, answered, resolved or expired", async () => {
    const t = await newBackendWithSources("cron");
    const acked = await createItem(t, { urgency: "today", title: "Acked" });
    const snoozed = await createItem(t, { urgency: "whenever", title: "Snoozed" });
    const answered = await createItem(t, {
      kind: "question",
      urgency: "now",
      title: "Answered",
      actions: [{ type: "reply" }],
    });
    const resolved = await createItem(t, { urgency: "today", title: "Resolved" });
    const expired = await createItem(t, { urgency: "today", expiresAt: NOW + MINUTE });
    const resolve = (id: string) =>
      request(t, `/api/items/${id}/events`, {
        method: "POST",
        bearer: SERVICE,
        body: { type: "state_changed", to: "resolved" },
      });

    await act(t, acked, { type: "ack" });
    await act(t, snoozed, { type: "snooze", until: NOW + 60 * MINUTE });
    await act(t, answered, { type: "reply", text: "Pool B" });
    await resolve(resolved);
    // Already not live: an acked item that resolves syncs nothing more.
    await resolve(acked);
    await advance(t, 2 * MINUTE);

    const handled = syncs().flatMap(({ itemIds }) => itemIds);
    expect(handled.toSorted()).toEqual([acked, snoozed, answered, resolved, expired].toSorted());
  });
});

describe("maintenance windows", () => {
  // Sources alone need no Alertmanager silence, so these windows make no outside call.
  async function startWindow(t: Backend, body: Record<string, unknown>) {
    const response = await request(t, "/api/me/maintenance-windows", {
      method: "POST",
      bearer: SERVICE,
      body: { title: "Cluster upgrade", durationMs: 60 * MINUTE, ...body },
    });
    expect(response.status).toBe(200);
    return maintenanceWindowResponseSchema.parse(response.json).window;
  }

  test("an item a window covers records the window and pushes nothing", async () => {
    const t = await newBackendWithSources("cron");
    const window = await startWindow(t, { sources: ["hermes"] });
    const id = await createItem(t, { urgency: "now", title: "Gateway restarted" });
    await advance(t, 30 * MINUTE);

    expect(alertPushes()).toEqual([]);
    expect((await getItem(t, id)).item.maintenanceWindowId).toBe(window.id);
    expect(await decisions(t, id)).toEqual([
      {
        trigger: "created",
        attempt: 0,
        decision: "skipped",
        why: "maintenance",
        maintenanceWindowId: window.id,
      },
    ]);
  });

  test("an item from a source the window leaves out pushes as usual", async () => {
    const t = await newBackendWithSources("cron");
    await startWindow(t, { sources: ["cron"] });
    const id = await createItem(t, { urgency: "now", title: "Gateway restarted" });

    expect(pushTitles()).toEqual(["Gateway restarted"]);
    expect((await getItem(t, id)).item.maintenanceWindowId).toBeUndefined();
  });

  test("Cowtail's own now items push through a window over every source", async () => {
    const t = await newBackendWithSources("cron");
    await startWindow(t, { sources: ["*"] });
    await createItem(t, { source: "cowtail", urgency: "now", title: "Alert pipeline silent" });

    expect(pushTitles()).toEqual(["Alert pipeline silent"]);
  });

  test("an alert whose labels equal the window's matchers pushes nothing", async () => {
    const t = await newBackendWithSources("cron");
    vi.stubEnv("COWTAIL_ALERTMANAGER_WEBHOOK_TOKEN", "alertmanager-token");
    vi.stubEnv("ALERTMANAGER_BASE_URL", "https://alertmanager.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) => {
        if (String(url) !== "https://alertmanager.test/api/v2/silences") {
          throw new Error(`unexpected fetch ${url}`);
        }
        return Response.json({ silenceID: "silence-1" });
      }),
    );
    const window = await startWindow(t, { matchers: [{ label: "namespace", value: "media" }] });
    const fire = (namespace: string) =>
      request(t, "/api/alerts/webhook", {
        method: "POST",
        bearer: "alertmanager-token",
        body: {
          status: "firing",
          alerts: [
            {
              status: "firing",
              fingerprint: `fp-${namespace}`,
              startsAt: new Date(NOW).toISOString(),
              labels: { alertname: "KubePodCrashLooping", severity: "critical", namespace },
              annotations: { description: "Pod restarted" },
            },
          ],
        },
      });
    expect((await fire("media")).status).toBe(200);
    expect((await fire("edge")).status).toBe(200);
    await advance(t, 1);

    const alerts = (await rows(t, "items")).map((item) => [
      item.context.namespace,
      item.maintenanceWindowId,
    ]);
    expect(alerts).toEqual([
      ["media", window.id],
      ["edge", undefined],
    ]);
    expect(alertPushes()).toHaveLength(1);
  });

  test("a today item batched before a window starts drops out of the batch", async () => {
    const t = await newBackendWithSources("cron");
    const id = await createItem(t, { urgency: "today", title: "Backup verify failed" });
    await startWindow(t, { sources: ["hermes"] });
    await advance(t, 5 * MINUTE);

    expect(alertPushes()).toEqual([]);
    expect((await decisions(t, id)).map(({ decision, why }) => [decision, why])).toEqual([
      ["batched", undefined],
      ["skipped", "maintenance"],
    ]);
  });
});

describe("notification preferences endpoints", () => {
  test("round-trip quiet hours, urgency overrides and the approval auth setting", async () => {
    const t = await newBackendWithSources("cron");
    const bearer = await ownerSession(t);
    const read = async () =>
      notificationPreferencesResponseSchema.parse(
        (await request(t, "/api/me/notification-preferences", { bearer })).json,
      ).preferences;

    const saved = {
      dailyRoundupEnabled: true,
      quietHours: { start: "22:00", end: "07:00", timeZone: "Europe/Berlin" },
      urgencyOverrides: { alertmanager: "today", "hermes:fyi": "whenever" },
      requireAuthForApprovals: true,
    };
    expect(await setPreferences(t, saved)).toEqual(saved);
    expect(await read()).toEqual(saved);

    // A field left out keeps its value; null turns quiet hours off.
    expect(await setPreferences(t, { quietHours: null })).toEqual({ ...saved, quietHours: null });
    expect(await read()).toEqual({ ...saved, quietHours: null });
  });
});
