import { describe, expect, test } from "bun:test";

import { createOrCoalesceForAlert, fail, requeue } from "./investigationJobs";

function handler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
}

describe("durable investigation job transitions", () => {
  test("coalesces a new event into an already claimed alert job", async () => {
    const job: Record<string, unknown> = {
      _id: "job-1",
      alertId: "alert-1",
      sourceEventId: "event-1",
      status: "claimed",
    };
    const ctx = {
      db: {
        query: () => ({
          withIndex: (_index: string, apply: (query: unknown) => void) => {
            const query = { eq: () => query };
            apply(query);
            return { collect: async () => [job] };
          },
        }),
        patch: async (_id: string, patch: Record<string, unknown>) => Object.assign(job, patch),
        insert: async () => {
          throw new Error("should not insert a duplicate active job");
        },
      },
    };

    const result = await handler(createOrCoalesceForAlert)(ctx, {
      alertId: "alert-1",
      sourceEventId: "event-2",
      fingerprint: "fingerprint-1",
      dedupeKey: "dedupe-1",
      alertStatus: "firing",
      severity: "warning",
      now: 200,
    });

    expect(result).toBe("job-1");
    expect(job).toMatchObject({ sourceEventId: "event-2", status: "claimed", updatedAt: 200 });
  });

  test("rejects a late failure after an owner invalidated the claim", async () => {
    const ctx = {
      db: {
        get: async () => ({
          _id: "job-1",
          status: "done",
          claimToken: undefined,
          attempts: 1,
          maxAttempts: 5,
          errorHistory: [],
        }),
      },
    };

    await expect(
      handler(fail)(ctx, {
        id: "job-1",
        claimToken: "stale-token",
        phase: "probe",
        error: "late worker failure",
        retryable: true,
        now: 300,
      }),
    ).rejects.toThrow("job is not claimed by this token");
  });

  test("manual requeue starts a fresh attempt budget and clears terminal state", async () => {
    const job: Record<string, unknown> = {
      _id: "job-1",
      status: "deadletter",
      attempts: 5,
      lastError: "secret internal error",
      errorHistory: [{ at: 100, phase: "probe", error: "secret", retryable: false }],
      completedAt: 120,
      deadletteredAt: 130,
      deadletterReason: "secret internal error",
    };
    const ctx = {
      db: {
        patch: async (_id: string, patch: Record<string, unknown>) => Object.assign(job, patch),
      },
    };

    await handler(requeue)(ctx, { id: "job-1", now: 400 });

    expect(job).toMatchObject({
      status: "queued",
      attempts: 0,
      nextAttemptAt: 400,
      errorHistory: [],
      updatedAt: 400,
    });
    expect(job.lastError).toBeUndefined();
    expect(job.completedAt).toBeUndefined();
    expect(job.deadletteredAt).toBeUndefined();
    expect(job.deadletterReason).toBeUndefined();
  });
});
