import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import {
  type Backend,
  newBackend,
  row as get,
  rows,
  seedInvestigation,
} from "../test/convexHarness";

async function createContext(t: Backend) {
  const { alertIds, jobId } = await seedInvestigation(t, {
    alerts: [{ action: "" }, { action: "" }],
    job: { claimToken: "secret-token", claimedBy: "worker-1", leaseUntil: 200 },
  });
  return { alertId: alertIds[0], siblingId: alertIds[1], jobId };
}

describe("atomic owner alert actions", () => {
  test("classifies the alert and invalidates an active worker claim together", async () => {
    const t = newBackend();
    const { alertId, siblingId, jobId } = await createContext(t);

    const result = await t.mutation(internal.alerts.applyOwnerAction, {
      id: alertId,
      action: "mark-noise",
      note: "Expected maintenance",
      now: 300,
    });

    expect(result).toEqual({ ok: true, status: "done" });
    expect(await get(t, alertId)).toMatchObject({
      outcome: "noise",
      ownerDisposition: "noise",
      ownerNote: "Expected maintenance",
      ownerUpdatedAt: 300,
      action: "Marked as noise.",
    });
    expect(await get(t, siblingId)).toMatchObject({
      outcome: "noise",
      ownerDisposition: "noise",
      ownerNote: "Expected maintenance",
      action: "Marked as noise.",
    });
    const job = await get(t, jobId);
    expect(job).toMatchObject({ status: "done", completedAt: 300, updatedAt: 300 });
    expect(job?.claimedBy).toBeUndefined();
    expect(job?.claimToken).toBeUndefined();
  });

  test("requeues the job and its delivery in the same mutation", async () => {
    const t = newBackend();
    const { alertId, jobId } = await createContext(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: "deadletter" });
      await ctx.db.patch(alertId, { ownerDisposition: "escalated" });
      await ctx.db.insert("jobDeliveries", {
        jobId,
        target: "hermes:cowtail-alert-job",
        status: "failed",
        attempts: 3,
        nextAttemptAt: 100,
        createdAt: 100,
        updatedAt: 100,
      });
    });

    const result = await t.mutation(internal.alerts.applyOwnerAction, {
      id: alertId,
      action: "retry-investigation",
      now: 400,
    });

    expect(result).toEqual({ ok: true, status: "queued" });
    const alert = await get(t, alertId);
    expect(alert).toMatchObject({ outcome: "pending" });
    expect(alert?.ownerDisposition).toBeUndefined();
    expect(await get(t, jobId)).toMatchObject({
      status: "queued",
      attempts: 0,
      nextAttemptAt: 400,
      errorHistory: [],
    });
    expect(await rows(t, "jobDeliveries")).toMatchObject([
      { status: "pending", attempts: 0, nextAttemptAt: 400 },
    ]);
  });

  test("rejects a retry if a worker won the claim race", async () => {
    const t = newBackend();
    const { alertId } = await createContext(t);

    await expect(
      t.mutation(internal.alerts.applyOwnerAction, {
        id: alertId,
        action: "retry-investigation",
        now: 400,
      }),
    ).rejects.toThrow("already in progress");
  });
});
