import { expect, test, vi } from "vitest";
import {
  advance,
  newBackend,
  request,
  row,
  rows,
  seedInvestigation,
  stubEnv,
} from "../test/convexHarness";
import { internal } from "./_generated/api";

const bearer = "test-worker-token";
const deliveryUrl = "https://hermes.test/hook";
const claimPath = "/api/investigation-jobs/claim";

async function fixture(maxAttempts = 5) {
  vi.useFakeTimers({ now: 120_000 });
  stubEnv({
    COWTAIL_WORKER_TOKEN: bearer,
    COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL: deliveryUrl,
    COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN: "test-webhook-token",
  });
  const t = newBackend();
  const { jobId, alertIds } = await seedInvestigation(t, {
    alerts: [{}, {}],
    job: {
      status: "queued",
      attempts: 0,
      maxAttempts,
      claimedAt: undefined,
      claimedBy: undefined,
      claimToken: undefined,
      leaseUntil: undefined,
    },
  });
  const post = (path: string, body: unknown) => request(t, path, { method: "POST", bearer, body });
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    if (url !== deliveryUrl) throw new Error("unexpected request");
    expect(JSON.parse(String(options.body))).toMatchObject({ jobId });
    const id = new Headers(options.headers).get("x-request-id")!;
    sent.push(id);
    return Response.json({ status: "accepted", delivery_id: id }, { status: 202 });
  });
  const deliveryId = await t.mutation((internal as any).jobDeliveries.enqueue, {
    jobId,
    now: Date.now(),
  });
  await t.action((internal as any).jobDeliveryActions.deliverOne, { deliveryId });
  expect(sent).toEqual([deliveryId]);
  sent.length = 0;
  const evidence = {
    admissionId: "admission-one",
    sessionId: "session-one",
    generation: 1,
    deliveryId,
  };
  const claim = (execution = evidence) => post(claimPath, { jobId, leaseSeconds: 30, execution });
  expect(await claim()).toMatchObject({ status: 200, json: { claimed: true } });
  const original = await row(t, jobId);
  const stoppedPath = `/api/investigation-jobs/${jobId}/execution-stopped`;
  const stopped = (execution = evidence) => post(stoppedPath, { execution, outcome: "completed" });
  return { t, jobId, alertIds, original, evidence, claim, stopped, sent, post, stoppedPath };
}

test("broker redelivers a stopped claimed job once, then a replacement claims the same job", async () => {
  const { t, jobId, original, evidence, claim, stopped, sent } = await fixture();
  await advance(t, 31_000);
  await Promise.all([stopped(), stopped()]);
  await advance(t, 125_000);
  expect(sent).toHaveLength(1);
  expect(sent[0]).not.toBe(evidence.deliveryId);
  const deliveries = await rows(t, "jobDeliveries");
  expect(deliveries).toHaveLength(2);
  const fresh = deliveries.find((delivery) => delivery._id === sent[0])!;
  expect(await claim()).toMatchObject({ status: 200, json: { claimed: false } });
  expect(
    await claim({
      admissionId: "admission-two",
      sessionId: "session-two",
      generation: 1,
      deliveryId: fresh._id,
    }),
  ).toMatchObject({ status: 200, json: { claimed: true } });
  expect(await row(t, jobId)).toMatchObject({
    _id: jobId,
    status: "claimed",
    attempts: 2,
    recoveryPending: true,
  });
  expect((await row(t, jobId))?.claimToken).not.toBe(original?.claimToken);
  await expect(
    t.mutation((internal as any).investigationJobs.renew, {
      id: jobId,
      claimToken: original!.claimToken!,
      leaseSeconds: 30,
      now: Date.now(),
    }),
  ).rejects.toThrow("job is not claimed by this token");
});

test("a live lease refuses recovery even if the adapter has a matching terminal receipt", async () => {
  const { t, jobId, stopped } = await fixture();
  expect(await stopped()).toMatchObject({ status: 200, json: { status: "unchanged" } });
  expect(await row(t, jobId)).toMatchObject({ status: "claimed", attempts: 1 });
  expect(await rows(t, "jobDeliveries")).toHaveLength(1);
});

test("expired leases do not release on their own or with a mismatched generation", async () => {
  const { t, jobId, evidence, stopped } = await fixture();
  await advance(t, 125_000);
  expect(await stopped({ ...evidence, generation: 2 })).toMatchObject({
    status: 200,
    json: { status: "unchanged" },
  });
  expect(await row(t, jobId)).toMatchObject({ status: "claimed", attempts: 1 });
  expect(await rows(t, "jobDeliveries")).toHaveLength(1);
});

test("a disposition on a sibling alert prevents recovery of the entire batch", async () => {
  const { t, jobId, alertIds, stopped } = await fixture();
  await t.run((ctx) => ctx.db.patch(alertIds[1], { ownerDisposition: "escalated" }));
  await advance(t, 31_000);
  expect(await stopped()).toMatchObject({ status: 200, json: { status: "unchanged" } });
  expect(await row(t, jobId)).toMatchObject({ status: "claimed" });
  expect(await rows(t, "jobDeliveries")).toHaveLength(1);
});

test.each(["done", "deadletter", "failed"] as const)(
  "recovery does not revive %s",
  async (status) => {
    const { t, jobId, stopped } = await fixture();
    await t.run((ctx) => ctx.db.patch(jobId, { status }));
    await advance(t, 31_000);
    expect(await stopped()).toMatchObject({ status: 200, json: { status: "unchanged" } });
    expect(await row(t, jobId)).toMatchObject({ status });
    expect(await rows(t, "jobDeliveries")).toHaveLength(1);
  },
);

test("the final claim deadletters without another delivery and records why", async () => {
  const { t, jobId, stopped } = await fixture(1);
  await advance(t, 31_000);
  expect(await stopped()).toMatchObject({ status: 200, json: { status: "deadletter" } });
  expect(await row(t, jobId)).toMatchObject({
    status: "deadletter",
    attempts: 1,
    deadletterReason:
      "Hermes execution completed without settling the investigation; claim attempt limit reached",
  });
  expect(await rows(t, "jobDeliveries")).toHaveLength(1);
});

test("a stopped-execution report does not accept a non-worker credential", async () => {
  const { t, evidence, stoppedPath } = await fixture();
  await advance(t, 31_000);
  expect(
    await request(t, stoppedPath, {
      method: "POST",
      bearer: "wrong",
      body: { execution: evidence, outcome: "failed" },
    }),
  ).toMatchObject({ status: 401 });
  expect(await rows(t, "jobDeliveries")).toHaveLength(1);
});

test("a replacement needs its own live claim to record reconciliation", async () => {
  const { t, jobId, original, claim, stopped, sent, post } = await fixture();
  await advance(t, 31_000);
  await stopped();
  await advance(t, 125_000);
  const fresh = (await rows(t, "jobDeliveries")).find((delivery) => delivery._id === sent[0])!;
  await claim({
    admissionId: "admission-two",
    sessionId: "session-two",
    generation: 1,
    deliveryId: fresh._id,
  });
  const path = `/api/investigation-jobs/${jobId}/reconcile-recovery`;
  const findings = {
    priorEffects: "Prior release was published; read its final status",
    resourceOwnership: "Matched target to existing maintenance owner",
  };
  const claimToken = (await row(t, jobId))!.claimToken!;
  expect(await post(path, { claimToken, priorEffects: "", resourceOwnership: "" })).toMatchObject({
    status: 400,
  });
  expect(await post(path, { ...findings, claimToken: original?.claimToken })).toMatchObject({
    status: 200,
    json: { reconciled: false },
  });
  expect(await post(path, { ...findings, claimToken })).toMatchObject({
    status: 200,
    json: { reconciled: true },
  });
  expect(await row(t, jobId)).toMatchObject({ recoveryPending: false, reconciliation: findings });
});
