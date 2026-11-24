import {
  itemCreateResponseSchema,
  itemGetResponseSchema,
  itemInboxResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  itemSourcesResponseSchema,
  type ItemGetResponse,
} from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Doc } from "./_generated/dataModel";
import {
  type Backend,
  advance,
  alertFields,
  newBackendWithSources,
  request,
  rows,
  seedSession,
  stubEnv,
} from "../test/convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const SERVICE = "service-token";
const OWNER = "owner-user";

// The generated api predates this module; Convex resolves it by name.
const backfillAlertItems = makeFunctionReference<
  "mutation",
  { cursor?: string | null },
  { created: number; isDone: boolean }
>("items:backfillAlertItems");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({
    PUSH_API_BEARER_TOKEN: SERVICE,
    COWTAIL_OWNER_USER_ID: OWNER,
    COWTAIL_ALERTMANAGER_WEBHOOK_TOKEN: "alertmanager-token",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function createItem(t: Backend, body: Record<string, unknown>) {
  const response = await request(t, "/api/items", { method: "POST", bearer: SERVICE, body });
  expect(response.status).toBe(200);
  return itemCreateResponseSchema.parse(response.json);
}

async function getItem(t: Backend, id: string): Promise<ItemGetResponse> {
  const response = await request(t, `/api/items/${id}`, { bearer: SERVICE });
  expect(response.status).toBe(200);
  return itemGetResponseSchema.parse(response.json);
}

async function listItems(t: Backend, query = "") {
  const response = await request(t, `/api/items${query}`, { bearer: SERVICE });
  expect(response.status).toBe(200);
  return itemListResponseSchema.parse(response.json).items;
}

// Replays the timeline: `created` sets the first state and every state event moves it from
// the state before it. A state write without its event leaves the replay behind the item.
function expectTimelineReplaysState({ item, events }: ItemGetResponse) {
  const [created, ...rest] = events;
  expect(created.type).toBe("created");
  let state = created.payload.state;
  for (const event of rest) {
    if (event.type !== "state_changed" && event.type !== "resolved") continue;
    expect(event.payload.from).toBe(state);
    state = event.payload.to;
  }
  expect(state).toBe(item.state);
}

describe("item ingest", () => {
  test("a repeat of an open dedupeKey counts into the open item", async () => {
    const t = await newBackendWithSources("cron");
    const body = { source: "cron", kind: "failure", urgency: "today", title: "Backup failed" };

    const first = await createItem(t, { ...body, dedupeKey: "backup" });
    const second = await createItem(t, { ...body, dedupeKey: "backup" });

    expect(first).toMatchObject({ created: true, occurrenceCount: 1 });
    expect(second).toEqual({ ok: true, id: first.id, created: false, occurrenceCount: 2 });
    expect(await listItems(t)).toHaveLength(1);
    const { item, events } = await getItem(t, first.id);
    expect(item).toMatchObject({ state: "open", occurrenceCount: 2, source: "cron" });
    expect(events.map((event) => event.type)).toEqual(["created", "repeated"]);
  });

  test("a resolved item's dedupeKey starts a new item", async () => {
    const t = await newBackendWithSources("cron");
    const body = { source: "cron", kind: "failure", urgency: "today", title: "Backup failed" };
    const first = await createItem(t, { ...body, dedupeKey: "backup" });
    await request(t, `/api/items/${first.id}/events`, {
      method: "POST",
      bearer: SERVICE,
      body: { type: "state_changed", to: "resolved" },
    });

    const second = await createItem(t, { ...body, dedupeKey: "backup" });

    expect(second).toMatchObject({ created: true, occurrenceCount: 1 });
    expect(second.id).not.toBe(first.id);
  });

  test("a producer posts progress, then resolves its item", async () => {
    const t = await newBackendWithSources("cron");
    const { id } = await createItem(t, {
      source: "hermes",
      kind: "failure",
      urgency: "now",
      title: "Nightly backup verify failed",
    });

    const progress = await request(t, `/api/items/${id}/events`, {
      method: "POST",
      bearer: SERVICE,
      body: { type: "hermes_update", text: "Re-running against a fresh snapshot", actor: "hermes" },
    });
    vi.advanceTimersByTime(60_000);
    const resolved = await request(t, `/api/items/${id}/events`, {
      method: "POST",
      bearer: SERVICE,
      body: { type: "state_changed", to: "resolved", reason: "Verify passed" },
    });

    expect(progress.status).toBe(200);
    const update = { text: "Re-running against a fresh snapshot", at: NOW };
    expect(itemResponseSchema.parse(progress.json).item.latestUpdate).toEqual(update);
    expect(itemResponseSchema.parse(resolved.json).item).toMatchObject({
      state: "resolved",
      resolvedAt: NOW + 60_000,
      needsOwner: false,
      latestUpdate: update,
      outcome: "other",
      resolvedAfterMs: 60_000,
    });
    const timeline = await getItem(t, id);
    expect(timeline.events.map((event) => [event.type, event.actor])).toEqual([
      ["created", "hermes"],
      ["hermes_update", "hermes"],
      ["resolved", "service"],
    ]);
    expect(timeline.events[1].payload).toEqual({ text: "Re-running against a fresh snapshot" });
    expectTimelineReplaysState(timeline);
  });

  test("item endpoints refuse callers without a service token or the owner's session", async () => {
    const t = await newBackendWithSources("cron");
    const stranger = await seedSession(t, "someone-else");

    const anonymousCreate = await request(t, "/api/items", {
      method: "POST",
      body: { source: "cron", kind: "fyi", urgency: "whenever", title: "Hi" },
    });
    const strangerList = await request(t, "/api/items", { bearer: stranger });
    const serviceAction = await request(t, "/api/me/items/whatever/actions", {
      method: "POST",
      bearer: SERVICE,
      body: { type: "ack" },
    });

    expect(anonymousCreate.status).toBe(401);
    expect(strangerList.status).toBe(403);
    expect(serviceAction.status).toBe(401);
    expect(await rows(t, "items")).toEqual([]);
  });
});

describe("item deadlines", () => {
  test("an item still waiting at its deadline expires", async () => {
    const t = await newBackendWithSources("cron");
    const question = {
      source: "hermes",
      kind: "question",
      urgency: "now",
      title: "Which pool?",
      actions: [{ type: "reply" }],
    };
    const timed = await createItem(t, { ...question, expiresAt: NOW + 5 * 60_000 });
    const open = await createItem(t, question);

    await advance(t, 4 * 60_000);
    expect((await getItem(t, timed.id)).item.state).toBe("open");

    await advance(t, 2 * 60_000);
    const expired = await getItem(t, timed.id);
    expect(expired.item).toMatchObject({ state: "expired", needsOwner: false });
    expectTimelineReplaysState(expired);
    expect((await getItem(t, open.id)).item.state).toBe("open");
  });
});

describe("owner actions", () => {
  async function ownerActions(t: Backend) {
    const bearer = await seedSession(t, OWNER);
    return (id: string, body: Record<string, unknown>) =>
      request(t, `/api/me/items/${id}/actions`, { method: "POST", bearer, body });
  }

  test("the owner acks, then snoozes, an item and both land on its timeline", async () => {
    const t = await newBackendWithSources("cron");
    const act = await ownerActions(t);
    const { id } = await createItem(t, {
      source: "alertmanager",
      kind: "alert",
      urgency: "now",
      title: "KubePodCrashLooping",
    });

    const acked = await act(id, { type: "ack" });
    const snoozed = await act(id, { type: "snooze", until: NOW + 3_600_000 });

    expect(itemResponseSchema.parse(acked.json).item).toMatchObject({
      state: "acked",
      needsOwner: false,
    });
    expect(itemResponseSchema.parse(snoozed.json).item).toMatchObject({
      state: "snoozed",
      snoozedUntil: NOW + 3_600_000,
    });
    const timeline = await getItem(t, id);
    expect(timeline.events.map((event) => [event.type, event.actor])).toEqual([
      ["created", "alertmanager"],
      ["action_taken", OWNER],
      ["state_changed", OWNER],
      ["action_taken", OWNER],
      ["state_changed", OWNER],
    ]);
    expectTimelineReplaysState(timeline);
  });

  test("unsnooze returns a snoozed item to open, and refuses an item that is not snoozed", async () => {
    const t = await newBackendWithSources("cron");
    const act = await ownerActions(t);
    const { id } = await createItem(t, {
      source: "cron",
      kind: "fyi",
      urgency: "whenever",
      title: "Disk at 70%",
    });
    await act(id, { type: "snooze", until: NOW + 3_600_000 });

    const unsnoozed = await act(id, { type: "unsnooze" });
    const again = await act(id, { type: "unsnooze" });

    expect(unsnoozed.status).toBe(200);
    const item = itemResponseSchema.parse(unsnoozed.json).item;
    expect(item.state).toBe("open");
    expect(item.snoozedUntil).toBeUndefined();
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: "ITEM_NOT_SNOOZED" });
    const timeline = await getItem(t, id);
    expect(timeline.events.slice(-2).map((event) => [event.type, event.payload.to])).toEqual([
      ["action_taken", undefined],
      ["state_changed", "open"],
    ]);
    expectTimelineReplaysState(timeline);
  });

  test("an item whose remindAt has passed is created open", async () => {
    const t = await newBackendWithSources("cron");
    const { id } = await createItem(t, {
      source: "cron",
      kind: "fyi",
      urgency: "whenever",
      title: "Late reminder",
      remindAt: NOW - 1,
    });

    expect((await getItem(t, id)).item).toMatchObject({ state: "open" });
  });

  test("a snooze must end in the future", async () => {
    const t = await newBackendWithSources("cron");
    const act = await ownerActions(t);
    const { id } = await createItem(t, {
      source: "cron",
      kind: "fyi",
      urgency: "whenever",
      title: "Disk at 70%",
    });

    const response = await act(id, { type: "snooze", until: NOW });

    expect(response.status).toBe(400);
    expect((await getItem(t, id)).item.state).toBe("open");
  });

  test("an answer is recorded only for an action the item offers", async () => {
    const t = await newBackendWithSources("cron");
    const act = await ownerActions(t);
    const { id } = await createItem(t, {
      source: "hermes",
      kind: "question",
      urgency: "today",
      title: "OSD 4 is 88% full. Rebalance now or wait for the new disk?",
      actions: [{ type: "choose", options: ["Rebalance now", "Wait"] }],
    });

    const chosen = await act(id, { type: "choose", option: "Wait" });
    const unknownOption = await act(id, { type: "choose", option: "Panic" });
    const notOffered = await act(id, { type: "approve" });

    // Answered, the item waits on its producer, not the owner, and takes no second answer.
    expect(itemResponseSchema.parse(chosen.json).item).toMatchObject({
      state: "open",
      needsOwner: false,
      answeredAt: NOW,
      availableActions: [],
    });
    expect([unknownOption.status, notOffered.status]).toEqual([409, 409]);
    const { events } = await getItem(t, id);
    expect(events.map((event) => [event.type, event.payload])).toEqual([
      ["created", { state: "open" }],
      ["action_taken", { type: "choose", option: "Wait" }],
    ]);
  });

  test("an answer without Face ID is refused while the owner requires it", async () => {
    const t = await newBackendWithSources("cron");
    const bearer = await seedSession(t, OWNER);
    await request(t, "/api/me/notification-preferences", {
      method: "PUT",
      bearer,
      body: { requireAuthForApprovals: true },
    });
    const { id } = await createItem(t, {
      source: "hermes",
      kind: "approval",
      urgency: "now",
      title: "Restart ingress in edge?",
      actions: [{ type: "approve" }, { type: "deny" }],
    });
    const approve = (authenticated: boolean) =>
      request(t, `/api/me/items/${id}/actions?authenticated=${authenticated}`, {
        method: "POST",
        bearer,
        body: { type: "approve" },
      });

    // The item tells the app to ask for Face ID.
    expect((await getItem(t, id)).item.approvalNeedsAuth).toBe(true);
    // An older app sends no flag; that is no Face ID too.
    const unflagged = await request(t, `/api/me/items/${id}/actions`, {
      method: "POST",
      bearer,
      body: { type: "approve" },
    });
    const unprotected = await approve(false);
    const protectedApproval = await approve(true);

    expect(unflagged).toMatchObject({ status: 403, json: { code: "APPROVAL_NEEDS_AUTH" } });
    expect(unprotected).toMatchObject({ status: 403, json: { code: "APPROVAL_NEEDS_AUTH" } });
    expect(protectedApproval.status).toBe(200);
    const { events } = await getItem(t, id);
    expect(events.filter((event) => event.type === "action_taken")).toHaveLength(1);
  });

  test("a closed item takes no more actions", async () => {
    const t = await newBackendWithSources("cron");
    const act = await ownerActions(t);
    const { id } = await createItem(t, {
      source: "cron",
      kind: "fyi",
      urgency: "whenever",
      title: "Certificate renewed",
    });
    await request(t, `/api/items/${id}/events`, {
      method: "POST",
      bearer: SERVICE,
      body: { type: "state_changed", to: "expired" },
    });

    const response = await act(id, { type: "ack" });

    expect(response.status).toBe(409);
    expect((await getItem(t, id)).item.state).toBe("expired");
  });
});

describe("item list", () => {
  test("filters by state, needsOwner, source and creation time", async () => {
    const t = await newBackendWithSources("cron");
    const approval = await createItem(t, {
      source: "hermes",
      kind: "approval",
      urgency: "today",
      title: "Restart ingress in edge?",
      actions: [{ type: "approve" }, { type: "deny" }],
    });
    vi.advanceTimersByTime(1_000);
    const fyi = await createItem(t, {
      source: "cron",
      kind: "fyi",
      urgency: "whenever",
      title: "Weekly report ready",
    });

    const ids = (items: { id: string }[]) => items.map((item) => item.id);
    expect(ids(await listItems(t))).toEqual([fyi.id, approval.id]);
    const sources = await request(t, "/api/items/sources", { bearer: SERVICE });
    expect(itemSourcesResponseSchema.parse(sources.json).sources).toEqual(["cron", "hermes"]);
    expect(ids(await listItems(t, "?kind=approval"))).toEqual([approval.id]);
    expect(ids(await listItems(t, "?q=INGRESS"))).toEqual([approval.id]);
    expect(ids(await listItems(t, "?outcome=other"))).toEqual([]);
    // A page names each item's day and counts that day across the whole filtered list.
    const firstPage = await request(t, "/api/items?limit=1", { bearer: SERVICE });
    expect(itemListResponseSchema.parse(firstPage.json)).toMatchObject({
      items: [{ id: fyi.id, createdDate: "2026-11-24" }],
      days: [{ date: "2026-11-24", count: 2 }],
    });
    const approvals = await request(t, "/api/items?kind=approval", { bearer: SERVICE });
    expect(itemListResponseSchema.parse(approvals.json).days).toEqual([
      { date: "2026-11-24", count: 1 },
    ]);
    expect(ids(await listItems(t, "?needsOwner=true"))).toEqual([approval.id]);
    expect(ids(await listItems(t, "?needsOwner=false"))).toEqual([fyi.id]);
    expect(ids(await listItems(t, "?source=cron"))).toEqual([fyi.id]);
    expect(ids(await listItems(t, `?from=${NOW + 1}`))).toEqual([fyi.id]);
    expect(ids(await listItems(t, `?source=hermes&to=${NOW}`))).toEqual([approval.id]);
    expect(ids(await listItems(t, "?limit=1"))).toEqual([fyi.id]);
    expect(ids(await listItems(t, "?state=resolved"))).toEqual([]);
    expect((await request(t, "/api/items?needsOwner=maybe", { bearer: SERVICE })).status).toBe(400);
  });

  test("lists the newest created first, backfilled history included", async () => {
    const t = await newBackendWithSources("cron");
    const fresh = await createItem(t, {
      source: "cron",
      kind: "fyi",
      urgency: "whenever",
      title: "Weekly report ready",
    });
    await t.run((ctx) => ctx.db.insert("alerts", alertFields({ timestamp: NOW - 86_400_000 })));
    await t.mutation(backfillAlertItems, {});

    const [first, second] = await listItems(t, "?limit=1&needsOwner=false");
    const all = await listItems(t);

    expect([first?.id, second]).toEqual([fresh.id, undefined]);
    expect(all.map((item) => item.createdAt)).toEqual([NOW, NOW - 86_400_000]);
  });

  test("a page reads at most limit items and nextCursor continues it", async () => {
    const t = await newBackendWithSources("cron");
    for (const title of ["first", "second", "third"]) {
      await createItem(t, { source: "cron", kind: "fyi", urgency: "whenever", title });
      vi.advanceTimersByTime(1_000);
    }
    const page = async (query: string) => {
      const response = await request(t, `/api/items${query}`, { bearer: SERVICE });
      return itemListResponseSchema.parse(response.json);
    };

    const one = await page("?limit=2&needsOwner=true");
    const two = await page("?limit=2");
    const three = await page(`?limit=2&cursor=${encodeURIComponent(two.nextCursor ?? "")}`);

    // Two items read, none needs the owner: an empty page that still continues.
    expect(one).toMatchObject({ count: 0, items: [], nextCursor: expect.any(String) });
    expect(two.items.map((item) => item.title)).toEqual(["third", "second"]);
    expect(three.items.map((item) => item.title)).toEqual(["first"]);
    expect(three.nextCursor).toBeUndefined();
    expect((await request(t, "/api/items?cursor=nonsense", { bearer: SERVICE })).status).toBe(400);
  });
});

describe("inbox", () => {
  test("splits open items by whether they need the owner, lists snoozed items soonest first and the day's resolved", async () => {
    const t = await newBackendWithSources("cron");
    const bearer = await seedSession(t, OWNER);
    const resolve = (id: string) =>
      request(t, `/api/items/${id}/events`, {
        method: "POST",
        bearer: SERVICE,
        body: { type: "state_changed", to: "resolved" },
      });
    const item = (title: string, kind: string, urgency = "today") =>
      createItem(t, { source: "hermes", kind, urgency, title });

    const yesterday = await item("Resolved yesterday", "fyi");
    await resolve(yesterday.id);
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    const approval = await item("Restart ingress in edge?", "approval");
    const working = await item("Nightly backup verify failed", "failure");
    const acked = await item("Disk at 90%", "failure", "now");
    vi.advanceTimersByTime(1_000);
    await request(t, `/api/me/items/${acked.id}/actions`, {
      method: "POST",
      bearer,
      body: { type: "ack" },
    });
    const today = await item("Certificate renewed", "fyi");
    await resolve(today.id);
    const snooze = (id: string, until: number) =>
      request(t, `/api/me/items/${id}/actions`, {
        method: "POST",
        bearer,
        body: { type: "snooze", until },
      });
    const monday = await item("Merge queue stalled", "failure");
    await snooze(monday.id, Date.now() + 3 * 24 * 60 * 60 * 1000);
    const reminder = await createItem(t, {
      source: "hermes",
      kind: "fyi",
      urgency: "whenever",
      title: "Check the disk shipment",
      remindAt: Date.now() + 60 * 60 * 1000,
    });

    const response = await request(t, "/api/items/inbox", { bearer });

    expect(response.status).toBe(200);
    const inbox = itemInboxResponseSchema.parse(response.json);
    expect(inbox.counts).toEqual({ needsYou: 1, withHermes: 2, upcoming: 2, handled: 1 });
    const ids = (items: { id: string }[] = []) => items.map((entry) => entry.id);
    expect([
      ids(inbox.needsYou),
      ids(inbox.withHermes),
      ids(inbox.upcoming),
      ids(inbox.handled),
    ]).toEqual([[approval.id], [acked.id, working.id], [reminder.id, monday.id], [today.id]]);
  });
});

describe("inbox bounds", () => {
  test("a flood of items fills a section only up to the read limit, newest first", async () => {
    const t = await newBackendWithSources("cron");
    const bearer = await seedSession(t, OWNER);
    await t.run(async (ctx) => {
      for (let n = 0; n < 501; n += 1) {
        await ctx.db.insert("items", {
          source: "cron",
          kind: "fyi",
          urgency: "whenever",
          state: "open",
          title: `Flood ${n}`,
          body: "",
          links: [],
          context: {},
          occurrenceCount: 1,
          actions: [],
          createdAt: NOW + n,
          updatedAt: NOW + n,
        });
      }
    });

    const response = await request(t, "/api/items/inbox", { bearer });

    const inbox = itemInboxResponseSchema.parse(response.json);
    expect(inbox.counts.withHermes).toBe(500);
    expect([inbox.withHermes[0]?.title, inbox.withHermes.at(-1)?.title]).toEqual([
      "Flood 500",
      "Flood 1",
    ]);
  });
});

describe("history day counts", () => {
  test("a flood of items in one day counts only up to the read limit", async () => {
    const t = await newBackendWithSources("cron");
    await t.run(async (ctx) => {
      for (let n = 0; n < 1001; n += 1) {
        await ctx.db.insert("items", {
          source: "cron",
          kind: "fyi",
          urgency: "whenever",
          state: "open",
          title: `Flood ${n}`,
          body: "",
          links: [],
          context: {},
          occurrenceCount: 1,
          actions: [],
          createdAt: NOW + n,
          updatedAt: NOW + n,
        });
      }
    });

    const response = await request(t, "/api/items?limit=1", { bearer: SERVICE });

    expect(itemListResponseSchema.parse(response.json).days).toEqual([
      { date: "2026-11-24", count: 1000 },
    ]);
  });
});

describe("alert items", () => {
  function alertmanagerPayload(status: "firing" | "resolved") {
    return {
      receiver: "cowtail-direct",
      status,
      alerts: [
        {
          status,
          fingerprint: "fp-1",
          startsAt: new Date(NOW - 60_000).toISOString(),
          endsAt: status === "resolved" ? new Date(NOW + 90_000).toISOString() : undefined,
          labels: { alertname: "KubePodCrashLooping", severity: "critical", namespace: "media" },
          annotations: { description: "Pod transcoder restarted 6 times" },
        },
      ],
    };
  }

  test("an Alertmanager alert keeps one item through its lifecycle", async () => {
    const t = await newBackendWithSources("cron");
    const webhook = (status: "firing" | "resolved") =>
      request(t, "/api/alerts/webhook", {
        method: "POST",
        bearer: "alertmanager-token",
        body: alertmanagerPayload(status),
      });

    expect((await webhook("firing")).status).toBe(200);
    vi.advanceTimersByTime(60_000);
    expect((await webhook("firing")).status).toBe(200);
    vi.advanceTimersByTime(60_000);
    expect((await webhook("resolved")).status).toBe(200);

    const [alert] = await rows(t, "alerts");
    const [listed, ...others] = await listItems(t);
    expect(others).toEqual([]);
    expect(await listItems(t, `?alertId=${alert._id}`)).toEqual([listed]);
    expect(listed).toMatchObject({
      alertId: alert._id,
      subtitle: "media",
      outcome: "self-resolved",
      // Resolved, it keeps its ack and snooze but offers neither.
      actions: [{ type: "ack" }, { type: "snooze" }],
      availableActions: [],
      source: "alertmanager",
      kind: "alert",
      urgency: "now",
      state: "resolved",
      title: "KubePodCrashLooping",
      body: "Pod transcoder restarted 6 times",
      occurrenceCount: 3,
      context: { namespace: "media", severity: "critical", outcome: "self-resolved" },
    });
    const timeline = await getItem(t, listed.id);
    // Delivery decisions are itemDelivery.test.ts's; this timeline is the lifecycle.
    const lifecycle = timeline.events.filter((event) => event.type !== "notified");
    expect(lifecycle.map((event) => event.type)).toEqual([
      "created",
      "repeated",
      "repeated",
      "resolved",
    ]);
    expectTimelineReplaysState(timeline);
  });

  // Each of the states the apps derived from an alert on the client, and the item state and
  // needsOwner the server now ships for it.
  const workflowCases: Array<{
    workflow: string;
    alert: Partial<Doc<"alerts">>;
    job?: Doc<"investigationJobs">["status"];
    state: "open" | "resolved";
    needsOwner: boolean;
    step?: "queued" | "investigating" | "failed";
    outcome?: string;
    // The newest investigation is over, so the owner may run it again.
    retry?: true;
  }> = [
    {
      workflow: "investigation failed",
      alert: {},
      job: "failed",
      state: "open",
      needsOwner: true,
      step: "failed",
      retry: true,
    },
    {
      workflow: "investigation deadlettered",
      alert: {},
      job: "deadletter",
      state: "open",
      needsOwner: true,
      step: "failed",
      retry: true,
    },
    {
      workflow: "needs review (owner escalated)",
      alert: { ownerDisposition: "escalated", outcome: "escalated" },
      state: "open",
      needsOwner: true,
    },
    {
      workflow: "needs review (escalated after resolution)",
      alert: { status: "resolved", outcome: "escalated" },
      state: "open",
      needsOwner: true,
    },
    {
      workflow: "investigating",
      alert: {},
      job: "claimed",
      state: "open",
      needsOwner: false,
      step: "investigating",
    },
    {
      workflow: "queued",
      alert: {},
      job: "queued",
      state: "open",
      needsOwner: false,
      step: "queued",
    },
    {
      workflow: "monitoring",
      alert: { outcome: "fixed" },
      job: "done",
      state: "open",
      needsOwner: false,
      retry: true,
    },
    { workflow: "active", alert: { outcome: "recorded" }, state: "open", needsOwner: false },
    {
      workflow: "recovered",
      alert: { status: "resolved", outcome: "self-resolved" },
      state: "resolved",
      needsOwner: false,
      outcome: "self-resolved",
    },
    {
      workflow: "fixed",
      alert: { status: "resolved", outcome: "fixed" },
      state: "resolved",
      needsOwner: false,
      outcome: "fixed",
    },
    {
      workflow: "noise",
      alert: { ownerDisposition: "noise", outcome: "noise" },
      state: "resolved",
      needsOwner: false,
      outcome: "noise",
    },
    {
      workflow: "recorded",
      alert: { status: "unknown", outcome: "recorded" },
      state: "resolved",
      needsOwner: false,
      outcome: "other",
    },
  ];

  test.each(workflowCases)("$workflow → $state, needsOwner $needsOwner", async (example) => {
    const t = await newBackendWithSources("cron");
    await t.run(async (ctx) => {
      const alertId = await ctx.db.insert("alerts", alertFields(example.alert));
      if (!example.job) return;
      const eventId = await ctx.db.insert("alertmanagerEvents", {
        receivedAt: 40,
        source: "alertmanager",
        status: "firing",
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        rawPayload: {},
        payloadHash: "hash",
        createdAlertIds: [alertId],
        createdJobIds: [],
        ingestStatus: "normalized",
      });
      await ctx.db.insert("investigationJobs", {
        alertId,
        sourceEventId: eventId,
        fingerprint: "fp",
        dedupeKey: "dedupe",
        status: example.job,
        priority: "normal",
        attempts: 1,
        maxAttempts: 5,
        nextAttemptAt: 50,
        errorHistory: [],
        createdAt: 50,
        updatedAt: 50,
      });
    });

    await t.mutation(backfillAlertItems, {});

    const [item] = await listItems(t);
    expect(item).toMatchObject({ state: example.state, needsOwner: example.needsOwner });
    expect([item.investigationStep, item.outcome]).toEqual([example.step, example.outcome]);
    expect(item.alertActions).toEqual([
      ...(example.retry ? ["retry-investigation"] : []),
      "mark-noise",
      "escalate",
    ]);
    expect(item.investigationResult).toEqual({ action: "Original action" });
    expect(item.context.disposition).toBe(example.workflow === "noise" ? "noise" : undefined);
    expectTimelineReplaysState(await getItem(t, item.id));
  });

  test("an alert whose source URL is not a web link still lists, without the link", async () => {
    const t = await newBackendWithSources("cron");
    await t.run((ctx) =>
      ctx.db.insert("alerts", alertFields({ generatorURL: "javascript:alert(1)" })),
    );

    await t.mutation(backfillAlertItems, {});

    expect((await listItems(t)).map((item) => item.links)).toEqual([[]]);
  });

  test("an alert's item carries the fixes recorded against the alert, newest first, and lists the newest", async () => {
    const t = await newBackendWithSources("cron");
    const [alertId, otherId] = await t.run(async (ctx) => [
      await ctx.db.insert("alerts", alertFields({})),
      await ctx.db.insert("alerts", alertFields({ alertname: "Other" })),
    ]);
    await t.run(async (ctx) => {
      const fix = (timestamp: number, alertIds: (typeof alertId)[], description: string) =>
        ctx.db.insert("fixes", {
          timestamp,
          alertIds,
          description,
          rootCause: "OOM",
          scope: "reactive",
        });
      await fix(10, [alertId], "Raised the memory limit");
      await fix(20, [alertId, otherId], "Pinned the image");
      await fix(30, [otherId], "Unrelated");
    });
    await t.mutation(backfillAlertItems, {});

    const [item] = await listItems(t, `?alertId=${alertId}`);
    const { fixes } = await getItem(t, item.id);

    expect(fixes?.map((fix) => fix.description)).toEqual([
      "Pinned the image",
      "Raised the memory limit",
    ]);
    expect(item.fix?.description).toBe("Pinned the image");
  });

  test("the backfill creates one item per alert and is safe to run again", async () => {
    const t = await newBackendWithSources("cron");
    await t.run(async (ctx) => {
      for (const alertname of ["TargetDown", "CephHealthWarn", "NodeMemoryPressure"]) {
        await ctx.db.insert("alerts", alertFields({ alertname }));
      }
    });

    expect(await t.mutation(backfillAlertItems, {})).toEqual({ created: 3, isDone: true });
    expect(await t.mutation(backfillAlertItems, {})).toEqual({ created: 0, isDone: true });

    const alerts = await rows(t, "alerts");
    const items = await rows(t, "items");
    expect(items.map((item) => item.alertId).sort()).toEqual(
      alerts.map((alert) => alert._id).sort(),
    );
  });

  test("the owner's noise call resolves the alert's item", async () => {
    const t = await newBackendWithSources("cron");
    await request(t, "/api/alerts/webhook", {
      method: "POST",
      bearer: "alertmanager-token",
      body: alertmanagerPayload("firing"),
    });
    const [alert] = await rows(t, "alerts");
    const bearer = await seedSession(t, OWNER);

    const response = await request(t, `/api/me/alerts/${alert._id}/actions`, {
      method: "POST",
      bearer,
      body: { action: "mark-noise", note: "Flaps during backups" },
    });

    expect(response.status).toBe(200);
    const [item] = await listItems(t);
    expect(item).toMatchObject({ state: "resolved", context: { disposition: "noise" } });
    // The owner's note stays on the item's detail.
    expect(item.investigationResult?.ownerNote).toBe("Flaps during backups");
    expect((await getItem(t, item.id)).events.at(-1)).toMatchObject({
      type: "resolved",
      actor: "owner",
    });
  });
});
