import { describe, expect, test } from "bun:test";

import { completeBatch, createOrCoalesceForAlert, fail, requeue } from "./investigationJobs";

function handler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
}

describe("durable investigation job transitions", () => {
  test("does not mutate a claimed batch snapshot when a new event arrives", async () => {
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
        insert: async () => "job-2",
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

    expect(result).toBe("job-2");
    expect(job).toMatchObject({ sourceEventId: "event-1", status: "claimed" });
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

  test("completes every firing alert in a batch atomically", async () => {
    const tables: Record<string, Record<string, any>> = {
      "job-1": {
        _id: "job-1",
        alertId: "alert-1",
        sourceEventId: "event-1",
        status: "claimed",
        claimToken: "claim-1",
      },
      "event-1": {
        _id: "event-1",
        investigationAlertIds: ["alert-1", "alert-2", "alert-3"],
      },
      "alert-1": { _id: "alert-1", sourceEventId: "event-1", status: "firing" },
      "alert-2": { _id: "alert-2", sourceEventId: "event-1", status: "firing" },
      "alert-3": { _id: "alert-3", sourceEventId: "event-1", status: "firing" },
    };
    const ctx = {
      db: {
        get: async (id: string) => tables[id] ?? null,
        patch: async (id: string, patch: Record<string, unknown>) =>
          Object.assign(tables[id], patch),
      },
    };
    const results = ["alert-1", "alert-2", "alert-3"].map((alertId) => ({
      alertId,
      outcome: "recorded",
      summary: `Handled ${alertId}`,
      action: "Investigated as one incident batch",
      messaged: false,
    }));

    await handler(completeBatch)(ctx, {
      id: "job-1",
      claimToken: "claim-1",
      results,
      now: 500,
    });

    expect(tables["job-1"]).toMatchObject({ status: "done", completedAt: 500 });
    expect(tables["alert-1"]).toMatchObject({ outcome: "recorded", summary: "Handled alert-1" });
    expect(tables["alert-2"]).toMatchObject({ outcome: "recorded", summary: "Handled alert-2" });
    expect(tables["alert-3"]).toMatchObject({ outcome: "recorded", summary: "Handled alert-3" });
  });

  test("refuses to complete a batch with an unhandled sibling", async () => {
    const job = {
      _id: "job-1",
      alertId: "alert-1",
      sourceEventId: "event-1",
      status: "claimed",
      claimToken: "claim-1",
    };
    const sourceEvent = { investigationAlertIds: ["alert-1", "alert-2"] };
    const ctx = {
      db: {
        get: async (id: string) => (id === "job-1" ? job : id === "event-1" ? sourceEvent : null),
      },
    };

    await expect(
      handler(completeBatch)(ctx, {
        id: "job-1",
        claimToken: "claim-1",
        results: [
          {
            alertId: "alert-1",
            outcome: "recorded",
            summary: "Only handled the representative",
            action: "Investigated",
            messaged: false,
          },
        ],
        now: 500,
      }),
    ).rejects.toThrow("every firing alert");
  });

  test("refuses to complete a batch with a pending outcome", async () => {
    const job = {
      _id: "job-1",
      alertId: "alert-1",
      sourceEventId: "event-1",
      status: "claimed",
      claimToken: "claim-1",
    };
    const sourceEvent = { investigationAlertIds: ["alert-1"] };
    const ctx = {
      db: {
        get: async (id: string) => (id === "job-1" ? job : id === "event-1" ? sourceEvent : null),
      },
    };

    await expect(
      handler(completeBatch)(ctx, {
        id: "job-1",
        claimToken: "claim-1",
        results: [
          {
            alertId: "alert-1",
            outcome: "pending",
            summary: "Not handled",
            action: "No action",
            messaged: false,
          },
        ],
        now: 500,
      }),
    ).rejects.toThrow("pending is not terminal");
  });
});
