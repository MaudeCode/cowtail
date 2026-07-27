import { describe, expect, test } from "bun:test";

import { applyOwnerAction } from "./alerts";

function createContext(options?: { delivery?: Record<string, unknown> }) {
  const alert: Record<string, unknown> = {
    _id: "alert-1",
    outcome: "pending",
    action: "",
  };
  const job: Record<string, unknown> = {
    _id: "job-1",
    alertId: "alert-1",
    status: "claimed",
    attempts: 2,
    claimedBy: "worker-1",
    claimToken: "secret-token",
    claimedAt: 100,
    leaseUntil: 200,
    updatedAt: 100,
  };
  const deliveries: Record<string, unknown>[] = options?.delivery ? [options.delivery] : [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "alert-1") return alert;
        if (id === "job-1") return job;
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (id === "alert-1") Object.assign(alert, patch);
        else if (id === "job-1") Object.assign(job, patch);
        else {
          const delivery = deliveries.find((candidate) => candidate._id === id);
          if (delivery) Object.assign(delivery, patch);
        }
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        const id = `delivery-${deliveries.length + 1}`;
        deliveries.push({ _id: id, ...value });
        return id;
      },
      query: (table: string) => ({
        withIndex: (_index: string, _apply: unknown) => ({
          collect: async () => (table === "investigationJobs" ? [job] : []),
          first: async () => (table === "jobDeliveries" ? (deliveries[0] ?? null) : null),
        }),
      }),
    },
  };

  return { ctx, alert, job, deliveries };
}

describe("atomic owner alert actions", () => {
  test("classifies the alert and invalidates an active worker claim together", async () => {
    const { ctx, alert, job } = createContext();

    const result = await (applyOwnerAction as any)._handler(ctx, {
      id: "alert-1",
      action: "mark-noise",
      note: "Expected maintenance",
      now: 300,
    });

    expect(result).toEqual({ ok: true, status: "done" });
    expect(alert).toMatchObject({
      outcome: "noise",
      ownerDisposition: "noise",
      ownerNote: "Expected maintenance",
      ownerUpdatedAt: 300,
      action: "Marked as noise.",
    });
    expect(job).toMatchObject({ status: "done", completedAt: 300, updatedAt: 300 });
    expect(job.claimedBy).toBeUndefined();
    expect(job.claimToken).toBeUndefined();
  });

  test("requeues the job and its delivery in the same mutation", async () => {
    const delivery = {
      _id: "delivery-1",
      jobId: "job-1",
      status: "failed",
      attempts: 3,
    };
    const { ctx, alert, job, deliveries } = createContext({ delivery });
    job.status = "deadletter";
    alert.ownerDisposition = "escalated";

    const result = await (applyOwnerAction as any)._handler(ctx, {
      id: "alert-1",
      action: "retry-investigation",
      now: 400,
    });

    expect(result).toEqual({ ok: true, status: "queued" });
    expect(alert).toMatchObject({ outcome: "pending" });
    expect(alert.ownerDisposition).toBeUndefined();
    expect(job).toMatchObject({
      status: "queued",
      attempts: 0,
      nextAttemptAt: 400,
      errorHistory: [],
    });
    expect(deliveries[0]).toMatchObject({ status: "pending", attempts: 0, nextAttemptAt: 400 });
  });

  test("rejects a retry if a worker won the claim race", async () => {
    const { ctx } = createContext();

    await expect(
      (applyOwnerAction as any)._handler(ctx, {
        id: "alert-1",
        action: "retry-investigation",
        now: 400,
      }),
    ).rejects.toThrow("already in progress");
  });
});
