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

    expect(second).toMatchObject({ status: 409, json: { code: "ANSWER_PENDING" } });
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

    expect(await status(t)).toEqual({
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
