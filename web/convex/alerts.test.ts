import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import { getById, updateOutcome } from "./alerts";
import { type Backend, newBackend, rows } from "../test/convexHarness";

type ConvexFunctionForTest = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

function convexHandler(fn: unknown) {
  return (fn as ConvexFunctionForTest)._handler;
}

async function seedEvent(t: Backend, payloadHash: string) {
  return await t.run((ctx) =>
    ctx.db.insert("alertmanagerEvents", {
      receivedAt: 100,
      source: "alertmanager",
      status: "firing",
      groupLabels: {},
      commonLabels: {},
      commonAnnotations: {},
      rawPayload: {},
      payloadHash,
      createdAlertIds: [],
      createdJobIds: [],
      ingestStatus: "normalized",
    }),
  );
}

async function alertArgs(
  t: Backend,
  overrides: Record<string, unknown> & { payloadHash?: string } = {},
) {
  const { payloadHash = "event-1", ...rest } = overrides;
  return {
    sourceEventId: await seedEvent(t, payloadHash),
    dedupeKey: JSON.stringify(["fingerprint-1", 100]),
    alertmanagerFingerprint: "fingerprint-1",
    timestamp: 100,
    startsAt: 100,
    generatorURL: "https://example.test/alerts",
    alertname: "CowtailLifecycleProbe",
    severity: "warning",
    namespace: "observability",
    status: "firing",
    investigationPending: true,
    summary: "Probe firing",
    labels: { alertname: "CowtailLifecycleProbe", severity: "warning" },
    annotations: { summary: "Probe firing" },
    ...rest,
  };
}

const upsert = (t: Backend, args: Awaited<ReturnType<typeof alertArgs>>) =>
  t.mutation(internal.alerts.upsertFromAlertmanager, args);

describe("Alertmanager alert upsert", () => {
  test("updates one row from firing to resolved", async () => {
    const t = newBackend();

    const firingId = await upsert(t, await alertArgs(t));
    const resolvedArgs = await alertArgs(t, {
      payloadHash: "event-2",
      status: "resolved",
      investigationPending: false,
      endsAt: 200,
      summary: "Probe resolved",
    });
    const resolvedId = await upsert(t, resolvedArgs);

    expect(resolvedId).toBe(firingId);
    const alerts = await rows(t, "alerts");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      _id: firingId,
      status: "resolved",
      outcome: "self-resolved",
      startsAt: 100,
      endsAt: 200,
      resolvedAt: 200,
      occurrenceCount: 2,
      sourceEventId: resolvedArgs.sourceEventId,
    });
  });

  test("preserves a completed investigation outcome on resolution", async () => {
    const t = newBackend();

    const id = await upsert(t, await alertArgs(t));
    await t.run((ctx) =>
      ctx.db.patch(id, {
        outcome: "fixed",
        summary: "Root cause fixed",
        action: "Applied a verified fix.",
        rootCause: "Broken configuration",
      }),
    );

    await upsert(
      t,
      await alertArgs(t, {
        payloadHash: "event-2",
        status: "resolved",
        investigationPending: false,
        endsAt: 200,
      }),
    );

    const alerts = await rows(t, "alerts");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      _id: id,
      status: "resolved",
      outcome: "fixed",
      summary: "Root cause fixed",
      rootCause: "Broken configuration",
    });
  });

  test("creates a new row for a later occurrence with a new start time", async () => {
    const t = newBackend();

    await upsert(t, await alertArgs(t));
    await upsert(
      t,
      await alertArgs(t, {
        payloadHash: "event-2",
        dedupeKey: JSON.stringify(["fingerprint-1", 300]),
        timestamp: 300,
        startsAt: 300,
      }),
    );

    expect(await rows(t, "alerts")).toHaveLength(2);
  });
});

describe("Alertmanager lifecycle duplicate migration", () => {
  test("keeps the firing row and rewires durable references before deleting the resolved duplicate", async () => {
    const t = newBackend();
    const firingEventId = await seedEvent(t, "event-firing");
    const resolvedEventId = await seedEvent(t, "event-resolved");
    const shared = {
      timestamp: 100,
      alertname: "CowtailLifecycleProbe",
      severity: "warning",
      namespace: "observability",
      messaged: false,
      source: "alertmanager" as const,
      alertmanagerFingerprint: "fingerprint-1",
      startsAt: 100,
      labels: { alertname: "CowtailLifecycleProbe" },
      annotations: {},
      occurrenceCount: 1,
    };
    const { firingId } = await t.run(async (ctx) => {
      const firingId = await ctx.db.insert("alerts", {
        ...shared,
        status: "firing",
        outcome: "noise",
        summary: "Synthetic probe handled",
        action: "No action required.",
        rootCause: "Synthetic probe",
        sourceEventId: firingEventId,
        dedupeKey: "old-firing-key",
        lastReceivedAt: 110,
      });
      const resolvedId = await ctx.db.insert("alerts", {
        ...shared,
        status: "resolved",
        outcome: "self-resolved",
        summary: "Probe resolved",
        action: "Alertmanager reported this alert resolved.",
        sourceEventId: resolvedEventId,
        dedupeKey: "old-resolved-key",
        endsAt: 200,
        resolvedAt: 200,
        lastReceivedAt: 210,
      });
      await ctx.db.patch(firingEventId, {
        createdAlertIds: [firingId],
        investigationAlertIds: [firingId],
      });
      await ctx.db.patch(resolvedEventId, {
        createdAlertIds: [resolvedId],
        investigationAlertIds: [resolvedId],
      });
      await ctx.db.insert("investigationJobs", {
        alertId: resolvedId,
        sourceEventId: resolvedEventId,
        fingerprint: "fingerprint-1",
        dedupeKey: "old-resolved-key",
        status: "done",
        priority: "normal",
        attempts: 1,
        maxAttempts: 5,
        nextAttemptAt: 100,
        errorHistory: [],
        createdAt: 100,
        updatedAt: 100,
      });
      await ctx.db.insert("fixes", {
        timestamp: 300,
        alertIds: [firingId, resolvedId],
        description: "Fixed the probe",
        rootCause: "Synthetic probe",
        scope: "reactive",
      });
      return { firingId, resolvedId };
    });

    const result = await t.mutation(internal.alerts.mergeLifecycleDuplicateGroup, {
      fingerprint: "fingerprint-1",
      startsAt: 100,
    });

    expect(result).toEqual({ ok: true, survivorId: firingId, merged: 1 });
    const alerts = await rows(t, "alerts");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      _id: firingId,
      status: "resolved",
      outcome: "noise",
      endsAt: 200,
      resolvedAt: 200,
      occurrenceCount: 2,
      sourceEventId: resolvedEventId,
    });
    expect(await rows(t, "investigationJobs")).toMatchObject([
      { alertId: firingId, dedupeKey: JSON.stringify(["fingerprint-1", 100]) },
    ]);
    expect((await rows(t, "fixes"))[0]?.alertIds).toEqual([firingId]);
    const events = await rows(t, "alertmanagerEvents");
    expect(events.map((event) => event.createdAlertIds)).toEqual([[firingId], [firingId]]);
    expect(events.map((event) => event.investigationAlertIds)).toEqual([[firingId], [firingId]]);
  });
});

describe("owner-facing alert workflow", () => {
  test("does not let a late worker result overwrite an owner disposition", async () => {
    const alert = {
      _id: "alert-1",
      ownerDisposition: "noise",
      outcome: "noise",
      summary: "Owner classified",
      action: "Marked as noise.",
    };
    const ctx = {
      db: {
        get: async () => alert,
        patch: async (_id: string, value: Record<string, unknown>) => Object.assign(alert, value),
      },
    };

    const result = await convexHandler(updateOutcome)(ctx, {
      id: "alert-1",
      outcome: "fixed",
      summary: "Worker finished late",
      action: "Applied a fix",
      messaged: true,
    });

    expect(result).toEqual({ ok: true, updated: false, reason: "owner-disposition" });
    expect(alert).toMatchObject({
      ownerDisposition: "noise",
      outcome: "noise",
      summary: "Owner classified",
    });
  });

  test("returns the latest sanitized durable investigation", async () => {
    const alert = {
      _id: "alert-1",
      timestamp: 100,
      alertname: "Probe",
      severity: "warning",
      status: "firing",
      outcome: "pending",
      summary: "Probe firing",
      ownerDisposition: "escalated",
      ownerNote: "Private owner note",
      ownerUpdatedAt: 203,
    };
    const jobs = [
      {
        _id: "job-old",
        _creationTime: 1,
        alertId: "alert-1",
        status: "done",
        priority: "normal",
        attempts: 1,
        maxAttempts: 5,
        nextAttemptAt: 100,
        lastError: "",
        errorHistory: [],
        updatedAt: 100,
        claimToken: "private-old-token",
        claimedBy: "old-worker",
      },
      {
        _id: "job-new",
        _creationTime: 2,
        alertId: "alert-1",
        status: "claimed",
        priority: "high",
        attempts: 2,
        maxAttempts: 5,
        nextAttemptAt: 200,
        claimedAt: 201,
        leaseUntil: 300,
        lastError: "postgres://user:password@internal/database",
        errorHistory: [
          {
            at: 201,
            phase: "Probe",
            error: "postgres://user:password@internal/database",
            retryable: true,
          },
        ],
        updatedAt: 202,
        claimToken: "private-current-token",
        claimedBy: "worker-1",
      },
    ];
    const ctx = {
      db: {
        get: async () => alert,
        query: () => ({
          withIndex: (_index: string, apply: (query: any) => unknown) => {
            const query = { eq: () => query };
            apply(query);
            return { collect: async () => jobs };
          },
        }),
      },
    };

    const result = (await convexHandler(getById)(ctx, { id: "alert-1" })) as Record<string, any>;

    expect(result.investigation).toMatchObject({
      id: "job-new",
      status: "claimed",
      priority: "high",
      attempts: 2,
      claimedAt: 201,
      leaseUntil: 300,
      lastError: "The investigation worker reported a failure.",
      lastErrorPhase: "probe",
    });
    expect(JSON.stringify(result.investigation)).not.toContain("password");
    expect("claimToken" in result.investigation).toBe(false);
    expect(result.ownerDisposition).toBe("escalated");
    expect("ownerNote" in result).toBe(false);
    expect("claimedBy" in result.investigation).toBe(false);
  });
});
