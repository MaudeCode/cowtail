import {
  hermesStatusResponseSchema,
  itemCreateResponseSchema,
  itemGetResponseSchema,
  runbookRunClaimResponseSchema,
  runbookRunGetResponseSchema,
  runbookRunResponseSchema,
  type RunbookScript,
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
const WORKER = "worker-token";
const OWNER = "owner-user";
const KB = 1024;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({ COWTAIL_WORKER_TOKEN: WORKER, COWTAIL_OWNER_USER_ID: OWNER });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const diskUsage: RunbookScript = { id: "disk-usage", name: "Disk usage", category: "diagnostics" };
const restartGateway: RunbookScript = {
  id: "gateway-restart",
  name: "Restart Hermes gateway",
  category: "services",
  confirm: "Restart the Hermes gateway?",
};
const wipeCache: RunbookScript = {
  id: "wipe-cache",
  name: "Wipe cache",
  category: "services",
  danger: true,
};

async function backend(runbook: RunbookScript[] = [diskUsage, restartGateway, wipeCache]) {
  const t = await newBackendWithSources();
  const heartbeat = await request(t, "/api/hermes/heartbeat", {
    method: "POST",
    bearer: WORKER,
    body: { platforms: [], cronJobs: [], openIncidents: [], runbook },
  });
  expect(heartbeat.status).toBe(200);
  return { t, owner: await seedSession(t, OWNER) };
}

function requestRun(t: Backend, owner: string, body: Record<string, unknown>) {
  return request(t, "/api/me/runbook/runs", { method: "POST", bearer: owner, body });
}

async function startRun(t: Backend, owner: string, body: Record<string, unknown>) {
  const response = await requestRun(t, owner, body);
  expect(response.status).toBe(200);
  return runbookRunResponseSchema.parse(response.json).run;
}

async function claim(t: Backend) {
  const response = await request(t, "/api/hermes/runbook-runs/claim", {
    method: "POST",
    bearer: WORKER,
    body: { workerId: "hermes-test", leaseSeconds: 60 },
  });
  expect(response.status).toBe(200);
  return runbookRunClaimResponseSchema.parse(response.json).run;
}

function sendOutput(t: Backend, id: string, body: Record<string, unknown>) {
  return request(t, `/api/hermes/runbook-runs/${id}/output`, {
    method: "POST",
    bearer: WORKER,
    body,
  });
}

async function getRun(t: Backend, owner: string, id: string) {
  const response = await request(t, `/api/me/runbook/runs/${id}`, { bearer: owner });
  expect(response.status).toBe(200);
  return runbookRunGetResponseSchema.parse(response.json);
}

describe("runbook requests", () => {
  test("refuse a script Hermes does not report", async () => {
    const { t, owner } = await backend();

    const response = await requestRun(t, owner, { scriptId: "rm-rf" });

    expect(response.status).toBe(404);
    expect(response.json).toMatchObject({ code: "UNKNOWN_SCRIPT" });
  });

  test("run a script with `confirm` or `danger` only once the owner confirmed", async () => {
    const { t, owner } = await backend();

    for (const scriptId of [restartGateway.id, wipeCache.id]) {
      const unconfirmed = await requestRun(t, owner, { scriptId, confirmed: false });
      expect(unconfirmed.status).toBe(400);
      expect(unconfirmed.json).toMatchObject({ code: "RUN_NEEDS_CONFIRM" });
      expect((await requestRun(t, owner, { scriptId, confirmed: true })).status).toBe(200);
    }
    expect((await requestRun(t, owner, { scriptId: diskUsage.id })).status).toBe(200);
  });

  test("need Face ID for a script that asks to confirm while the owner requires it", async () => {
    const { t, owner } = await backend();
    await request(t, "/api/me/notification-preferences", {
      method: "PUT",
      bearer: owner,
      body: { requireAuthForApprovals: true },
    });

    const unauthenticated = await requestRun(t, owner, {
      scriptId: restartGateway.id,
      confirmed: true,
    });
    expect(unauthenticated.status).toBe(403);
    expect(unauthenticated.json).toMatchObject({ code: "RUN_NEEDS_AUTH" });
    const status = hermesStatusResponseSchema.parse(
      (await request(t, "/api/hermes/status", { bearer: owner })).json,
    );
    expect(status.status?.runbook?.[1]?.scripts[0]).toMatchObject({
      id: restartGateway.id,
      confirmText: "Restart the Hermes gateway?",
      needsAuth: true,
    });
  });
});

describe("runbook leases", () => {
  test("lease a run once, then again after its lease runs out before its script started", async () => {
    const { t, owner } = await backend();
    const run = await startRun(t, owner, { scriptId: diskUsage.id });

    const first = await claim(t);
    expect(first).toMatchObject({ id: run.id, scriptId: diskUsage.id, attempts: 1 });
    expect(await claim(t)).toBeUndefined();

    await advance(t, 61_000);
    const second = await claim(t);
    expect(second).toMatchObject({ id: run.id, attempts: 2 });
    expect(second?.claimToken).not.toBe(first?.claimToken);
    const stale = await sendOutput(t, run.id, { claimToken: first!.claimToken, seq: 0, text: "x" });
    expect(stale.status).toBe(409);
  });

  test("never run a script again once it started; a lapsed lease leaves its outcome unknown", async () => {
    const { t, owner } = await backend();
    const run = await startRun(t, owner, { scriptId: diskUsage.id });
    const { claimToken } = (await claim(t))!;
    expect((await sendOutput(t, run.id, { claimToken, seq: 0, text: "" })).status).toBe(200);

    await advance(t, 61_000);

    expect(await claim(t)).toBeUndefined();
    expect((await getRun(t, owner, run.id)).run).toMatchObject({
      status: "unknown",
      active: false,
    });
  });
});

describe("runbook output", () => {
  test("append batches in order, storing a batch sent again once", async () => {
    const { t, owner } = await backend();
    const run = await startRun(t, owner, { scriptId: diskUsage.id });
    const { claimToken } = (await claim(t))!;

    expect((await sendOutput(t, run.id, { claimToken, seq: 0, text: "one\n" })).status).toBe(200);
    expect((await sendOutput(t, run.id, { claimToken, seq: 2, text: "three\n" })).status).toBe(409);
    expect((await sendOutput(t, run.id, { claimToken, seq: 0, text: "one\n" })).status).toBe(200);
    expect((await sendOutput(t, run.id, { claimToken, seq: 1, text: "two\n" })).status).toBe(200);

    expect((await getRun(t, owner, run.id)).output).toBe("one\ntwo\n");
  });

  test("truncate at 256 KB with a marker", async () => {
    const { t, owner } = await backend();
    const run = await startRun(t, owner, { scriptId: diskUsage.id });
    const { claimToken } = (await claim(t))!;

    for (let seq = 0; seq < 5; seq += 1) {
      const text = "x".repeat(60 * KB);
      expect((await sendOutput(t, run.id, { claimToken, seq, text })).status).toBe(200);
    }

    const { output } = await getRun(t, owner, run.id);
    expect(output).toBe(`${"x".repeat(256 * KB)}\n[Output truncated at 256 KB]\n`);
  });
});

describe("runbook runs for an item", () => {
  test("write the run's start and finish to the item's timeline", async () => {
    const { t, owner } = await backend();
    const created = await request(t, "/api/items", {
      method: "POST",
      bearer: WORKER,
      body: {
        source: "cowtail",
        kind: "failure",
        urgency: "now",
        title: "Gateway is not answering",
        actions: [{ type: "run", scriptId: restartGateway.id, label: "Restart Hermes gateway" }],
      },
    });
    const itemId = itemCreateResponseSchema.parse(created.json).id;
    const item = itemGetResponseSchema.parse(
      (await request(t, `/api/items/${itemId}`, { bearer: owner })).json,
    ).item;
    expect(item.availableActions).toEqual([
      {
        type: "run",
        scriptId: restartGateway.id,
        label: "Restart Hermes gateway",
        confirmText: "Restart the Hermes gateway?",
        needsAuth: false,
      },
    ]);

    const run = await startRun(t, owner, {
      scriptId: restartGateway.id,
      itemId,
      confirmed: true,
    });
    const { claimToken } = (await claim(t))!;
    await sendOutput(t, run.id, { claimToken, seq: 0, text: "gateway restarted\n" });
    const complete = await request(t, `/api/hermes/runbook-runs/${run.id}/complete`, {
      method: "POST",
      bearer: WORKER,
      body: { claimToken, exitCode: 0 },
    });
    expect(complete.status).toBe(200);

    const { events } = itemGetResponseSchema.parse(
      (await request(t, `/api/items/${itemId}`, { bearer: owner })).json,
    );
    expect(
      events
        .filter((event) => event.type.startsWith("run_"))
        .map(({ type, actor, payload }) => [type, actor, payload]),
    ).toEqual([
      [
        "run_started",
        OWNER,
        { runId: run.id, scriptId: restartGateway.id, scriptName: "Restart Hermes gateway" },
      ],
      [
        "run_finished",
        "hermes",
        {
          runId: run.id,
          scriptId: restartGateway.id,
          scriptName: "Restart Hermes gateway",
          status: "succeeded",
          exitCode: 0,
          excerpt: "gateway restarted",
        },
      ],
    ]);
    expect((await getRun(t, owner, run.id)).run).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      active: false,
    });
  });
});
