import {
  itemCreateResponseSchema,
  itemGetResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  type ItemGetResponse,
} from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Doc } from "./_generated/dataModel";
import {
  type Backend,
  alertFields,
  newBackend,
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
    const t = newBackend();
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
    const t = newBackend();
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
    const t = newBackend();
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
    expect(itemResponseSchema.parse(resolved.json).item).toMatchObject({
      state: "resolved",
      resolvedAt: NOW + 60_000,
      needsOwner: false,
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
    const t = newBackend();
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

describe("owner actions", () => {
  async function ownerActions(t: Backend) {
    const bearer = await seedSession(t, OWNER);
    return (id: string, body: Record<string, unknown>) =>
      request(t, `/api/me/items/${id}/actions`, { method: "POST", bearer, body });
  }

  test("the owner acks, then snoozes, an item and both land on its timeline", async () => {
    const t = newBackend();
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

  test("a snooze must end in the future", async () => {
    const t = newBackend();
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
    const t = newBackend();
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

    expect(itemResponseSchema.parse(chosen.json).item).toMatchObject({
      state: "open",
      needsOwner: true,
    });
    expect([unknownOption.status, notOffered.status]).toEqual([409, 409]);
    const { events } = await getItem(t, id);
    expect(events.map((event) => [event.type, event.payload])).toEqual([
      ["created", { state: "open" }],
      ["action_taken", { type: "choose", option: "Wait" }],
    ]);
  });

  test("a closed item takes no more actions", async () => {
    const t = newBackend();
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
    const t = newBackend();
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
    expect(ids(await listItems(t, "?needsOwner=true"))).toEqual([approval.id]);
    expect(ids(await listItems(t, "?needsOwner=false"))).toEqual([fyi.id]);
    expect(ids(await listItems(t, "?source=cron"))).toEqual([fyi.id]);
    expect(ids(await listItems(t, `?from=${NOW + 1}`))).toEqual([fyi.id]);
    expect(ids(await listItems(t, `?source=hermes&to=${NOW}`))).toEqual([approval.id]);
    expect(ids(await listItems(t, "?limit=1"))).toEqual([fyi.id]);
    expect(ids(await listItems(t, "?state=resolved"))).toEqual([]);
    expect((await request(t, "/api/items?needsOwner=maybe", { bearer: SERVICE })).status).toBe(400);
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
    const t = newBackend();
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
    expect(listed).toMatchObject({
      alertId: alert._id,
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
    expect(timeline.events.map((event) => event.type)).toEqual([
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
  }> = [
    { workflow: "investigation failed", alert: {}, job: "failed", state: "open", needsOwner: true },
    {
      workflow: "investigation deadlettered",
      alert: {},
      job: "deadletter",
      state: "open",
      needsOwner: true,
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
    { workflow: "investigating", alert: {}, job: "claimed", state: "open", needsOwner: false },
    { workflow: "queued", alert: {}, job: "queued", state: "open", needsOwner: false },
    {
      workflow: "monitoring",
      alert: { outcome: "fixed" },
      job: "done",
      state: "open",
      needsOwner: false,
    },
    { workflow: "active", alert: { outcome: "recorded" }, state: "open", needsOwner: false },
    {
      workflow: "recovered",
      alert: { status: "resolved", outcome: "self-resolved" },
      state: "resolved",
      needsOwner: false,
    },
    {
      workflow: "fixed",
      alert: { status: "resolved", outcome: "fixed" },
      state: "resolved",
      needsOwner: false,
    },
    {
      workflow: "noise",
      alert: { ownerDisposition: "noise", outcome: "noise" },
      state: "resolved",
      needsOwner: false,
    },
    {
      workflow: "recorded",
      alert: { status: "unknown", outcome: "recorded" },
      state: "resolved",
      needsOwner: false,
    },
  ];

  test.each(workflowCases)("$workflow → $state, needsOwner $needsOwner", async (example) => {
    const t = newBackend();
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
    expect(item.context.disposition).toBe(example.workflow === "noise" ? "noise" : undefined);
    expectTimelineReplaysState(await getItem(t, item.id));
  });

  test("an alert whose source URL is not a web link still lists, without the link", async () => {
    const t = newBackend();
    await t.run((ctx) =>
      ctx.db.insert("alerts", alertFields({ generatorURL: "javascript:alert(1)" })),
    );

    await t.mutation(backfillAlertItems, {});

    expect((await listItems(t)).map((item) => item.links)).toEqual([[]]);
  });

  test("the backfill creates one item per alert and is safe to run again", async () => {
    const t = newBackend();
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
    const t = newBackend();
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
      body: { action: "mark-noise" },
    });

    expect(response.status).toBe(200);
    const [item] = await listItems(t);
    expect(item).toMatchObject({ state: "resolved", context: { disposition: "noise" } });
    expect((await getItem(t, item.id)).events.at(-1)).toMatchObject({
      type: "resolved",
      actor: "owner",
    });
  });
});
