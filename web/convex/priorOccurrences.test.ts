import { itemGetResponseSchema } from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import {
  type Backend,
  alertFields,
  newBackend,
  request,
  seedInvestigation,
  stubEnv,
} from "../test/convexHarness";

const WORKER = "worker-token";

// The generated api predates this module; Convex resolves it by name.
const backfillAlertItems = makeFunctionReference<"mutation", { cursor?: string | null }>(
  "items:backfillAlertItems",
);

beforeEach(() => stubEnv({ COWTAIL_WORKER_TOKEN: WORKER }));
afterEach(() => vi.unstubAllEnvs());

type AlertSeed = Partial<Omit<Doc<"alerts">, "_id" | "_creationTime">>;

// The alert under test: fingerprint fp-a, KubePodCrashLooping in media, fired at 1000.
const current: AlertSeed = {
  alertname: "KubePodCrashLooping",
  namespace: "media",
  alertmanagerFingerprint: "fp-a",
  timestamp: 1000,
};

async function seedAlerts(t: Backend, seeds: Record<string, AlertSeed>) {
  const ids: Record<string, Id<"alerts">> = {};
  await t.run(async (ctx) => {
    for (const [name, seed] of Object.entries(seeds)) {
      ids[name] = await ctx.db.insert("alerts", alertFields({ ...current, ...seed }));
    }
  });
  return ids;
}

// The item detail of the alert's item, as GET /api/items/:id serves it.
async function itemDetail(t: Backend, alertId: Id<"alerts">) {
  await t.mutation(backfillAlertItems, {});
  const item = await t.run((ctx) =>
    ctx.db
      .query("items")
      .withIndex("by_alertId", (q) => q.eq("alertId", alertId))
      .first(),
  );
  const response = await request(t, `/api/items/${item!._id}`, { bearer: WORKER });
  expect(response.status).toBe(200);
  return itemGetResponseSchema.parse(response.json);
}

test("item detail matches by fingerprint first, then fills by alertname and namespace", async () => {
  const t = newBackend();
  const ids = await seedAlerts(t, {
    current: {},
    fingerprintOld: { timestamp: 500 },
    fingerprintRecent: { timestamp: 900 },
    nameNewest: { alertmanagerFingerprint: "fp-b", timestamp: 950 },
    nameOlder: { alertmanagerFingerprint: "fp-c", timestamp: 800 },
    otherNamespace: { alertmanagerFingerprint: "fp-d", namespace: "edge", timestamp: 990 },
    otherName: { alertmanagerFingerprint: "fp-e", alertname: "TargetDown", timestamp: 995 },
  });

  const { priorOccurrences } = await itemDetail(t, ids.current);

  expect(priorOccurrences?.map((prior) => prior.alertId)).toEqual([
    ids.nameNewest,
    ids.fingerprintRecent,
    ids.fingerprintOld,
  ]);
});

test("item detail returns at most 3 earlier firings, newest first, without the alert itself", async () => {
  const t = newBackend();
  const ids = await seedAlerts(t, {
    current: {},
    later: { timestamp: 2000 },
    first: { timestamp: 100 },
    second: { timestamp: 200 },
    third: { timestamp: 300 },
    fourth: { timestamp: 400 },
  });

  const { priorOccurrences } = await itemDetail(t, ids.current);

  expect(priorOccurrences?.map((prior) => prior.alertId)).toEqual([
    ids.fourth,
    ids.third,
    ids.second,
  ]);
});

test("item detail carries each earlier firing's result and its linked fixes", async () => {
  const t = newBackend();
  const ids = await seedAlerts(t, {
    current: {},
    prior: {
      timestamp: 400,
      status: "resolved",
      resolvedAt: 450,
      outcome: "fixed",
      summary: "OOMKilled at 256Mi",
      rootCause: "Memory limit too low",
    },
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("fixes", {
      timestamp: 460,
      alertIds: [ids.prior],
      description: "Raise transcoder memory limit",
      rootCause: "Memory limit too low",
      scope: "reactive",
      commit: "7be01d4",
    });
  });

  const { priorOccurrences } = await itemDetail(t, ids.current);

  expect(priorOccurrences).toEqual([
    {
      alertId: ids.prior,
      firedAt: 400,
      resolvedAt: 450,
      outcome: "fixed",
      rootCause: "Memory limit too low",
      summary: "OOMKilled at 256Mi",
      fixes: [
        {
          description: "Raise transcoder memory limit",
          rootCause: "Memory limit too low",
          commit: "7be01d4",
        },
      ],
    },
  ]);
});

test("an investigation claim carries each member alert's earlier firings", async () => {
  const t = newBackend();
  const { alertIds, jobId } = await seedInvestigation(t, {
    alerts: [current],
    job: { status: "queued", claimToken: undefined, claimedBy: undefined },
  });
  const { prior } = await seedAlerts(t, { prior: { timestamp: 400, outcome: "noise" } });

  const response = await request(t, "/api/investigation-jobs/claim", {
    method: "POST",
    bearer: WORKER,
    body: { jobId },
  });

  expect(response.status).toBe(200);
  expect(response.json).toMatchObject({
    claimed: true,
    priorOccurrences: { [alertIds[0]]: [{ alertId: prior, outcome: "noise", fixes: [] }] },
  });
});
