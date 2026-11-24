import {
  itemCreateResponseSchema,
  itemGetResponseSchema,
  notificationPreferencesResponseSchema,
} from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type Backend,
  advance,
  newBackend,
  request,
  seedSession,
  stubEnv,
} from "../test/convexHarness";

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

const pushTitles = () =>
  sendPushToUser.mock.calls.map(([, args]) => (args as { title: string }).title);

describe("item delivery", () => {
  test("a now item pushes at once and again every 10 minutes, three more times at most", async () => {
    const t = newBackend();
    const id = await createItem(t, { urgency: "now", title: "Restart ingress in edge?" });
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser.mock.calls[0][1]).toMatchObject({
      userId: OWNER,
      title: "Restart ingress in edge?",
      aps: { interruptionLevel: "time-sensitive" },
    });

    await advance(t, 60 * MINUTE);
    expect(sendPushToUser).toHaveBeenCalledTimes(4);
    expect((await decisions(t, id)).map(({ decision, attempt }) => [decision, attempt])).toEqual([
      ["pushed", 0],
      ["pushed", 1],
      ["pushed", 2],
      ["pushed", 3],
    ]);
  });

  test("acking a now item stops its re-sends", async () => {
    const t = newBackend();
    const id = await createItem(t, { urgency: "now" });
    await advance(t, 10 * MINUTE);
    expect(sendPushToUser).toHaveBeenCalledTimes(2);

    const ack = await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer: await ownerSession(t),
      body: { type: "ack" },
    });
    expect(ack.status).toBe(200);
    await advance(t, 60 * MINUTE);

    expect(sendPushToUser).toHaveBeenCalledTimes(2);
    expect((await decisions(t, id)).at(-1)).toMatchObject({
      trigger: "resend",
      decision: "skipped",
      why: "not_open",
    });
  });

  test("today items created within 5 minutes arrive as one push", async () => {
    const t = newBackend();
    const ids = [await createItem(t, { urgency: "today", title: "Backup verify failed" })];
    await advance(t, 2 * MINUTE);
    ids.push(await createItem(t, { urgency: "today", title: "Merge queue stalled" }));
    await advance(t, 2 * MINUTE);
    ids.push(await createItem(t, { urgency: "today", title: "Cert renews in 9 days" }));
    expect(sendPushToUser).not.toHaveBeenCalled();

    await advance(t, MINUTE);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser.mock.calls[0][1]).toMatchObject({
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
    const t = newBackend();
    const id = await createItem(t, { urgency: "whenever" });
    await advance(t, 60 * MINUTE);

    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(await decisions(t, id)).toEqual([
      { trigger: "created", attempt: 0, decision: "skipped", why: "whenever" },
    ]);
  });

  test("quiet hours hold today pushes until they end, and never hold now pushes", async () => {
    const t = newBackend();
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
    const t = newBackend();
    const id = await createItem(t, { urgency: "whenever", dedupeKey: "disk:osd-4" });
    expect(await createItem(t, { urgency: "now", dedupeKey: "disk:osd-4" })).toBe(id);

    expect((await getItem(t, id)).item.urgency).toBe("now");
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect((await decisions(t, id)).map(({ trigger, decision }) => [trigger, decision])).toEqual([
      ["created", "skipped"],
      ["urgency_raised", "pushed"],
    ]);
  });

  test("urgency overrides set the stored urgency when an item is created", async () => {
    const t = newBackend();
    await setPreferences(t, { urgencyOverrides: { cron: "whenever", "hermes:question": "now" } });

    const cron = await createItem(t, { source: "cron", kind: "failure", urgency: "now" });
    const question = await createItem(t, { kind: "question", urgency: "whenever" });
    const fyi = await createItem(t, { kind: "fyi", urgency: "today" });

    expect((await getItem(t, cron)).item.urgency).toBe("whenever");
    expect((await getItem(t, question)).item.urgency).toBe("now");
    expect((await getItem(t, fyi)).item.urgency).toBe("today");
  });
});

describe("notification preferences endpoints", () => {
  test("round-trip quiet hours, urgency overrides and the approval auth setting", async () => {
    const t = newBackend();
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
