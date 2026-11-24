import {
  hermesResponseClaimResponseSchema,
  hermesStatusResponseSchema,
  itemCreateResponseSchema,
  itemGetResponseSchema,
  itemListResponseSchema,
  type HermesSnapshot,
} from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type Backend,
  advance,
  newBackendWithSources,
  request,
  seedSession,
  stubEnv,
} from "../test/convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const SERVICE = "service-token";
const WORKER = "worker-token";
const OWNER = "owner-user";
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({
    PUSH_API_BEARER_TOKEN: SERVICE,
    COWTAIL_WORKER_TOKEN: WORKER,
    COWTAIL_OWNER_USER_ID: OWNER,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const approval = {
  source: "hermes",
  kind: "approval",
  urgency: "now",
  title: "Approve: delete the scratch volume",
  actions: [{ type: "approve" }, { type: "deny" }],
  replyTo: { type: "approval", sessionKey: "agent:main:cowtail:dm:owner" },
};

async function createItem(t: Backend, body: Record<string, unknown>) {
  const response = await request(t, "/api/items", { method: "POST", bearer: WORKER, body });
  expect(response.status).toBe(200);
  return itemCreateResponseSchema.parse(response.json).id;
}

const ownerSessions = new WeakMap<Backend, Promise<string>>();
function ownerSession(t: Backend) {
  if (!ownerSessions.has(t)) ownerSessions.set(t, seedSession(t, OWNER));
  return ownerSessions.get(t)!;
}

async function answer(t: Backend, id: string, body: Record<string, unknown>) {
  const bearer = await ownerSession(t);
  return await request(t, `/api/me/items/${id}/actions`, { method: "POST", bearer, body });
}

async function claim(t: Backend) {
  const response = await request(t, "/api/hermes/responses/claim", {
    method: "POST",
    bearer: WORKER,
    body: { workerId: "hermes-test", leaseSeconds: 60 },
  });
  expect(response.status).toBe(200);
  return hermesResponseClaimResponseSchema.parse(response.json).response;
}

async function getItem(t: Backend, id: string) {
  const response = await request(t, `/api/items/${id}`, { bearer: SERVICE });
  expect(response.status).toBe(200);
  return itemGetResponseSchema.parse(response.json);
}

async function claimedApproval(t: Backend) {
  const id = await createItem(t, approval);
  expect((await answer(t, id, { type: "approve" })).status).toBe(200);
  const response = await claim(t);
  expect(response).toBeDefined();
  return { id, response: response! };
}

describe("owner answers for Hermes", () => {
  test("an answer is leased to one claim at a time and leased again once its lease runs out", async () => {
    const t = await newBackendWithSources();
    const { id, response: first } = await claimedApproval(t);

    expect(first).toMatchObject({
      itemId: id,
      replyTo: approval.replyTo,
      answer: { type: "approve" },
      attempts: 1,
      leaseUntil: NOW + 60_000,
    });
    expect(await claim(t)).toBeUndefined();

    vi.advanceTimersByTime(60_000);
    const second = await claim(t);

    expect(second).toMatchObject({ id: first.id, attempts: 2 });
    expect(second!.claimToken).not.toBe(first.claimToken);
    const stale = await request(t, `/api/hermes/responses/${first.id}/complete`, {
      method: "POST",
      bearer: WORKER,
      body: { claimToken: first.claimToken },
    });
    expect(stale.status).toBe(409);
  });

  test("completing an answer resolves its item and records Hermes's update", async () => {
    const t = await newBackendWithSources();
    const { id, response } = await claimedApproval(t);

    const completed = await request(t, `/api/hermes/responses/${response.id}/complete`, {
      method: "POST",
      bearer: WORKER,
      body: { claimToken: response.claimToken, text: "Approved once; the command ran." },
    });

    expect(completed.status).toBe(200);
    const { item, events } = await getItem(t, id);
    expect(item.state).toBe("resolved");
    expect(events.map((event) => event.type)).toEqual([
      "created",
      "action_taken",
      "hermes_update",
      "resolved",
    ]);
    expect(events[2]).toMatchObject({
      actor: "hermes",
      payload: { text: "Approved once; the command ran." },
    });
    expect(await claim(t)).toBeUndefined();
  });

  test("an answer Hermes can no longer apply expires its item", async () => {
    const t = await newBackendWithSources();
    const { id, response } = await claimedApproval(t);

    const failed = await request(t, `/api/hermes/responses/${response.id}/fail`, {
      method: "POST",
      bearer: WORKER,
      body: { claimToken: response.claimToken, reason: "the approval request expired" },
    });

    expect(failed.status).toBe(200);
    const { item, events } = await getItem(t, id);
    expect(item.state).toBe("expired");
    expect(events.find((event) => event.type === "hermes_update")?.payload.text).toBe(
      "Hermes could not apply the answer: the approval request expired",
    );
  });

  test("an answer on its way to Hermes holds its item open past the deadline", async () => {
    const t = await newBackendWithSources();
    const id = await createItem(t, { ...approval, expiresAt: NOW + MINUTE });
    expect((await answer(t, id, { type: "approve" })).status).toBe(200);

    await advance(t, 2 * MINUTE);

    expect((await getItem(t, id)).item.state).toBe("open");
    const response = await claim(t);
    await request(t, `/api/hermes/responses/${response!.id}/complete`, {
      method: "POST",
      bearer: WORKER,
      body: { claimToken: response!.claimToken },
    });
    expect((await getItem(t, id)).item.state).toBe("resolved");
  });

  test("only the worker token may route an item's answers", async () => {
    const t = await newBackendWithSources();

    const service = await request(t, "/api/items", {
      method: "POST",
      bearer: SERVICE,
      body: approval,
    });
    const plain = await request(t, "/api/items", {
      method: "POST",
      bearer: SERVICE,
      body: { ...approval, replyTo: undefined },
    });

    expect(service.status).toBe(403);
    expect(plain.status).toBe(200);
    expect(await createItem(t, approval)).toBeTruthy();
  });

  test("only an offered action on an item with a replyTo goes back, one answer at a time", async () => {
    const t = await newBackendWithSources();
    const plain = await createItem(t, { ...approval, replyTo: undefined });
    const routed = await createItem(t, approval);

    expect((await answer(t, plain, { type: "approve" })).status).toBe(200);
    // The approval offers no ack, so an ack stays with Cowtail.
    expect((await answer(t, routed, { type: "ack" })).status).toBe(200);
    expect(await claim(t)).toBeUndefined();

    expect((await answer(t, routed, { type: "deny" })).status).toBe(200);
    const second = await answer(t, routed, { type: "approve" });

    // Answered, the item offers no second answer.
    expect(second).toMatchObject({ status: 409, json: { code: "ACTION_NOT_OFFERED" } });
    expect(await claim(t)).toMatchObject({ itemId: routed, answer: { type: "deny" } });
  });
});

const snapshot: HermesSnapshot = {
  platforms: ["cowtail", "telegram"],
  model: "claude-opus-5-5",
  provider: "anthropic",
  cronJobs: [
    {
      id: "job-1",
      name: "Nightly backup check",
      schedule: "0 3 * * *",
      lastRunAt: NOW - 9 * 3_600_000,
      lastStatus: "ok",
      nextRunAt: NOW + 15 * 3_600_000,
    },
  ],
  openIncidents: [],
  kanban: { blocked: 1, running: 2 },
};

async function heartbeat(t: Backend, body: HermesSnapshot = snapshot) {
  const response = await request(t, "/api/hermes/heartbeat", {
    method: "POST",
    bearer: WORKER,
    body,
  });
  expect(response.status).toBe(200);
}

async function status(t: Backend) {
  const response = await request(t, "/api/hermes/status", { bearer: await ownerSession(t) });
  expect(response.status).toBe(200);
  return hermesStatusResponseSchema.parse(response.json).status;
}

async function heartbeatItems(t: Backend) {
  const response = await request(t, "/api/items?source=cowtail", { bearer: SERVICE });
  return itemListResponseSchema
    .parse(response.json)
    .items.filter((item) => item.dedupeKey === "hermes:heartbeat-missing");
}

describe("Hermes heartbeat", () => {
  test("a heartbeat replaces the stored status snapshot", async () => {
    const t = await newBackendWithSources();
    await heartbeat(t);
    vi.advanceTimersByTime(MINUTE);
    await heartbeat(t, { ...snapshot, kanban: { blocked: 0, running: 3 } });

    expect(await status(t)).toMatchObject({
      receivedAt: NOW + MINUTE,
      heartbeatMissing: false,
      snapshot: { ...snapshot, kanban: { blocked: 0, running: 3 } },
    });
    expect((await request(t, "/api/hermes/status")).status).toBe(401);
  });

  test("a five-minute gap raises one heartbeat-missing item that the next heartbeat resolves", async () => {
    const t = await newBackendWithSources();
    await heartbeat(t);

    await advance(t, 4 * MINUTE);
    expect(await heartbeatItems(t)).toEqual([]);

    await advance(t, 6 * MINUTE);
    const [missing, ...extra] = await heartbeatItems(t);
    expect(extra).toEqual([]);
    expect(missing).toMatchObject({
      source: "cowtail",
      kind: "failure",
      urgency: "now",
      state: "open",
      occurrenceCount: 1,
    });
    expect((await status(t))?.heartbeatMissing).toBe(true);

    await heartbeat(t);
    expect((await getItem(t, missing.id)).item.state).toBe("resolved");
  });

  test("watching starts with the first heartbeat", async () => {
    const t = await newBackendWithSources();

    await advance(t, 10 * MINUTE);

    expect(await heartbeatItems(t)).toEqual([]);
    expect(await status(t)).toBeNull();
  });
});

describe("Hermes status level", () => {
  test.each([
    [0, "green"],
    [2 * MINUTE - 1, "green"],
    [2 * MINUTE, "amber"],
    [5 * MINUTE - 1, "amber"],
    [5 * MINUTE, "red"],
  ])("a heartbeat %i ms old is %s", async (age, level) => {
    const t = await newBackendWithSources();
    await heartbeat(t);
    vi.advanceTimersByTime(age);

    expect((await status(t))?.statusLevel).toBe(level);
  });

  test("an open heartbeat-missing item is red whatever the heartbeat's age", async () => {
    const t = await newBackendWithSources();
    await heartbeat(t);
    await advance(t, 6 * MINUTE);
    expect(await heartbeatItems(t)).toHaveLength(1);
    // A heartbeat stored without passing through the heartbeat route leaves the item open.
    await t.run(async (ctx) => {
      const stored = (await ctx.db.query("hermesStatus").first())!;
      await ctx.db.patch(stored._id, { receivedAt: Date.now() });
    });

    expect(await status(t)).toMatchObject({ heartbeatMissing: false, statusLevel: "red" });
  });
});

describe("Hermes status for the owner", () => {
  const failing = {
    id: "job-2",
    name: "Repo sweep",
    schedule: "*/30 * * * *",
    lastStatus: "error",
  };
  const incidentOnly = { id: "job-3", name: "Inbox triage", schedule: "15 * * * *" };
  const withCron: HermesSnapshot = {
    ...snapshot,
    cronJobs: [snapshot.cronJobs[0], failing, incidentOnly],
    openIncidents: [
      { id: "inc-1", jobId: "job-3", state: "open", firstSeenAt: NOW - 3_600_000 },
      { id: "inc-2", jobId: "job-gone", state: "open" },
    ],
  };

  test("cron jobs that failed or have an open incident come first and are counted", async () => {
    const t = await newBackendWithSources();
    await heartbeat(t, withCron);

    const current = await status(t);
    expect(current?.cronJobs?.map((job) => [job.id, job.failing])).toEqual([
      ["job-2", true],
      ["job-3", true],
      ["job-1", false],
    ]);
    expect(current).toMatchObject({ cronJobCount: 3, failingCronCount: 2, incidentCount: 2 });
  });

  test("blocked kanban work is flagged, and none is not", async () => {
    const t = await newBackendWithSources();
    await heartbeat(t, { ...snapshot, kanban: { blocked: 1, running: 0 } });
    expect((await status(t))?.kanbanBlocked).toBe(true);

    await heartbeat(t, { ...snapshot, kanban: { blocked: 0, running: 4 } });
    expect((await status(t))?.kanbanBlocked).toBe(false);
  });

  test("budget and rate-limit keys come in name order", async () => {
    const t = await newBackendWithSources();
    await heartbeat(t, {
      ...snapshot,
      budget: { weekly: "40%", daily: "62%" },
      rateLimits: { openai: "ok", anthropic: "limited" },
    });

    expect(await status(t)).toMatchObject({
      budgetOrder: ["daily", "weekly"],
      rateLimitOrder: ["anthropic", "openai"],
    });
  });

  test("an incident names its job and links the item whose dedupeKey is cron-incident:<id>", async () => {
    const t = await newBackendWithSources();
    const itemId = await createItem(t, {
      source: "hermes",
      kind: "failure",
      urgency: "now",
      title: "Inbox triage failed",
      dedupeKey: "cron-incident:inc-1",
    });
    await heartbeat(t, withCron);

    expect((await status(t))?.incidents).toEqual([
      {
        ...withCron.openIncidents[0],
        jobName: "Inbox triage",
        itemId,
        itemTitle: "Inbox triage failed",
      },
      { ...withCron.openIncidents[1] },
    ]);
  });

  test("recent answers list the owner's answers to approvals and questions from the last 7 days, newest first", async () => {
    const t = await newBackendWithSources();
    const old = await createItem(t, approval);
    expect((await answer(t, old, { type: "deny" })).status).toBe(200);
    vi.advanceTimersByTime(8 * 24 * 3_600_000);

    const approved = await createItem(t, { ...approval, title: "Restart ingress in edge?" });
    expect((await answer(t, approved, { type: "approve" })).status).toBe(200);
    vi.advanceTimersByTime(MINUTE);
    const question = await createItem(t, {
      source: "hermes",
      kind: "question",
      urgency: "now",
      title: "Rebalance now or wait?",
      actions: [{ type: "choose", options: ["Rebalance now", "Wait"] }],
    });
    expect((await answer(t, question, { type: "choose", option: "Wait" })).status).toBe(200);
    await createItem(t, { ...approval, title: "Not answered yet" });

    const response = await request(t, "/api/hermes/status", { bearer: await ownerSession(t) });
    const now = Date.now();
    expect(hermesStatusResponseSchema.parse(response.json).recentAnswers).toEqual([
      {
        itemId: question,
        title: "Rebalance now or wait?",
        answer: { type: "choose", option: "Wait" },
        answeredAt: now,
      },
      {
        itemId: approved,
        title: "Restart ingress in edge?",
        answer: { type: "approve" },
        answeredAt: now - MINUTE,
      },
    ]);
  });
});
