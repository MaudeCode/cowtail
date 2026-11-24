import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import type { Id } from "./_generated/dataModel";
import { fail, requeue, completeBatch as completeBatchMutation } from "./investigationJobs";
import { newBackend, row, seedInvestigation } from "../test/convexHarness";

// The generated api predates this module; Convex resolves it by name.
const createOrCoalesceForAlert = makeFunctionReference<
  "mutation",
  {
    alertId: Id<"alerts">;
    sourceEventId: Id<"alertmanagerEvents">;
    fingerprint: string;
    dedupeKey: string;
    alertStatus: string;
    severity: string;
    now: number;
  },
  Id<"investigationJobs"> | null
>("investigationJobs:createOrCoalesceForAlert");
const completeBatch = makeFunctionReference<"mutation">("investigationJobs:completeBatch");

function handler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
}

describe("durable investigation job transitions", () => {
  test("does not mutate a claimed batch snapshot when a new event arrives", async () => {
    const t = newBackend();
    const { alertIds, eventId, jobId } = await seedInvestigation(t);
    const laterEventId = await t.run((ctx) =>
      ctx.db.insert("alertmanagerEvents", {
        receivedAt: 200,
        source: "alertmanager",
        status: "firing",
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        rawPayload: {},
        payloadHash: "hash-2",
        createdAlertIds: [],
        createdJobIds: [],
        ingestStatus: "normalized",
      }),
    );

    const result = await t.mutation(createOrCoalesceForAlert, {
      alertId: alertIds[0],
      sourceEventId: laterEventId,
      fingerprint: "fingerprint-1",
      dedupeKey: "dedupe-1",
      alertStatus: "firing",
      severity: "warning",
      now: 200,
    });

    expect(result).not.toBe(jobId);
    expect(await row(t, jobId)).toMatchObject({ sourceEventId: eventId, status: "claimed" });
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

  test("completes every resolved alert in a batch atomically", async () => {
    const t = newBackend();
    const { alertIds, jobId } = await seedInvestigation(t, {
      alerts: [{ status: "resolved" }, { status: "resolved" }, { status: "resolved" }],
    });
    const results = alertIds.map((alertId, index) => ({
      alertId,
      outcome: "recorded",
      summary: `Handled alert-${index + 1}`,
      action: "Investigated as one incident batch",
      messaged: false,
    }));

    await t.mutation(completeBatch, { id: jobId, claimToken: "claim-1", results, now: 500 });

    expect(await row(t, jobId)).toMatchObject({ status: "done", completedAt: 500 });
    for (const [index, alertId] of alertIds.entries()) {
      expect(await row(t, alertId)).toMatchObject({
        outcome: "recorded",
        summary: `Handled alert-${index + 1}`,
      });
    }
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
      handler(completeBatchMutation)(ctx, {
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
      handler(completeBatchMutation)(ctx, {
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
