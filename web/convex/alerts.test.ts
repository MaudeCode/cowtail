import { describe, expect, test } from "bun:test";

import { mergeLifecycleDuplicateGroup, upsertFromAlertmanager } from "./alerts";

type AlertRow = Record<string, any> & { _id: string; _creationTime: number };
type ConvexFunctionForTest = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

function convexHandler(fn: unknown) {
  return (fn as ConvexFunctionForTest)._handler;
}

function createAlertMutationCtx() {
  const alerts: AlertRow[] = [];
  let nextId = 1;

  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, apply: (query: any) => unknown) => {
          const conditions: Array<[string, unknown]> = [];
          const query = {
            eq: (field: string, value: unknown) => {
              conditions.push([field, value]);
              return query;
            },
          };
          apply(query);
          return {
            collect: async () =>
              table === "alerts"
                ? alerts.filter((alert) =>
                    conditions.every(([field, value]) => alert[field] === value),
                  )
                : [],
          };
        },
        collect: async () => (table === "alerts" ? alerts : []),
      }),
      get: async (id: string) => alerts.find((alert) => alert._id === id) ?? null,
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}-${nextId++}`;
        if (table === "alerts") alerts.push({ _id: id, _creationTime: nextId, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const alert = alerts.find((candidate) => candidate._id === id);
        if (!alert) throw new Error(`Unknown alert ${id}`);
        Object.assign(alert, value);
      },
      delete: async (id: string) => {
        const index = alerts.findIndex((alert) => alert._id === id);
        if (index >= 0) alerts.splice(index, 1);
      },
    },
  };

  return { alerts, ctx };
}

function alertArgs(overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId: "event-1",
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
    ...overrides,
  };
}

describe("Alertmanager alert upsert", () => {
  test("updates one row from firing to resolved", async () => {
    const { alerts, ctx } = createAlertMutationCtx();
    const handler = convexHandler(upsertFromAlertmanager);

    const firingId = await handler(ctx, alertArgs());
    const resolvedId = await handler(
      ctx,
      alertArgs({
        sourceEventId: "event-2",
        status: "resolved",
        investigationPending: false,
        endsAt: 200,
        summary: "Probe resolved",
      }),
    );

    expect(resolvedId).toBe(firingId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      _id: firingId,
      status: "resolved",
      outcome: "self-resolved",
      startsAt: 100,
      endsAt: 200,
      resolvedAt: 200,
      occurrenceCount: 2,
      sourceEventId: "event-2",
    });
  });

  test("preserves a completed investigation outcome on resolution", async () => {
    const { alerts, ctx } = createAlertMutationCtx();
    const handler = convexHandler(upsertFromAlertmanager);

    const id = (await handler(ctx, alertArgs())) as string;
    Object.assign(alerts[0], {
      outcome: "fixed",
      summary: "Root cause fixed",
      action: "Applied a verified fix.",
      rootCause: "Broken configuration",
    });

    await handler(
      ctx,
      alertArgs({
        sourceEventId: "event-2",
        status: "resolved",
        investigationPending: false,
        endsAt: 200,
      }),
    );

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
    const { alerts, ctx } = createAlertMutationCtx();
    const handler = convexHandler(upsertFromAlertmanager);

    await handler(ctx, alertArgs());
    await handler(
      ctx,
      alertArgs({
        sourceEventId: "event-2",
        dedupeKey: JSON.stringify(["fingerprint-1", 300]),
        timestamp: 300,
        startsAt: 300,
      }),
    );

    expect(alerts).toHaveLength(2);
  });
});

describe("Alertmanager lifecycle duplicate migration", () => {
  test("keeps the firing row and rewires durable references before deleting the resolved duplicate", async () => {
    const tables: Record<string, Array<Record<string, any>>> = {
      alerts: [
        {
          _id: "alert-firing",
          _creationTime: 1,
          timestamp: 100,
          alertname: "CowtailLifecycleProbe",
          severity: "warning",
          namespace: "observability",
          status: "firing",
          outcome: "noise",
          summary: "Synthetic probe handled",
          action: "No action required.",
          rootCause: "Synthetic probe",
          messaged: false,
          source: "alertmanager",
          sourceEventId: "event-firing",
          alertmanagerFingerprint: "fingerprint-1",
          dedupeKey: "old-firing-key",
          startsAt: 100,
          labels: { alertname: "CowtailLifecycleProbe" },
          annotations: {},
          lastReceivedAt: 110,
          occurrenceCount: 1,
        },
        {
          _id: "alert-resolved",
          _creationTime: 2,
          timestamp: 100,
          alertname: "CowtailLifecycleProbe",
          severity: "warning",
          namespace: "observability",
          status: "resolved",
          outcome: "self-resolved",
          summary: "Probe resolved",
          action: "Alertmanager reported this alert resolved.",
          messaged: false,
          source: "alertmanager",
          sourceEventId: "event-resolved",
          alertmanagerFingerprint: "fingerprint-1",
          dedupeKey: "old-resolved-key",
          startsAt: 100,
          endsAt: 200,
          resolvedAt: 200,
          labels: { alertname: "CowtailLifecycleProbe" },
          annotations: {},
          lastReceivedAt: 210,
          occurrenceCount: 1,
        },
      ],
      investigationJobs: [
        {
          _id: "job-1",
          alertId: "alert-resolved",
          dedupeKey: "old-resolved-key",
        },
      ],
      fixes: [
        {
          _id: "fix-1",
          alertIds: ["alert-firing", "alert-resolved"],
        },
      ],
      alertmanagerEvents: [
        { _id: "event-firing", createdAlertIds: ["alert-firing"] },
        { _id: "event-resolved", createdAlertIds: ["alert-resolved"] },
      ],
    };

    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, apply: (query: any) => unknown) => {
            const conditions: Array<[string, unknown]> = [];
            const query = {
              eq: (field: string, value: unknown) => {
                conditions.push([field, value]);
                return query;
              },
            };
            apply(query);
            return {
              collect: async () =>
                (tables[table] ?? []).filter((row) =>
                  conditions.every(([field, value]) => row[field] === value),
                ),
            };
          },
          collect: async () => tables[table] ?? [],
        }),
        patch: async (id: string, value: Record<string, unknown>) => {
          const row = Object.values(tables)
            .flat()
            .find((candidate) => candidate._id === id);
          if (!row) throw new Error(`Unknown row ${id}`);
          Object.assign(row, value);
        },
        delete: async (id: string) => {
          for (const rows of Object.values(tables)) {
            const index = rows.findIndex((row) => row._id === id);
            if (index >= 0) rows.splice(index, 1);
          }
        },
      },
    };

    const result = await convexHandler(mergeLifecycleDuplicateGroup)(ctx, {
      fingerprint: "fingerprint-1",
      startsAt: 100,
    });

    expect(result).toEqual({ ok: true, survivorId: "alert-firing", merged: 1 });
    expect(tables.alerts).toHaveLength(1);
    expect(tables.alerts[0]).toMatchObject({
      _id: "alert-firing",
      status: "resolved",
      outcome: "noise",
      endsAt: 200,
      resolvedAt: 200,
      occurrenceCount: 2,
      sourceEventId: "event-resolved",
    });
    expect(tables.investigationJobs[0]).toMatchObject({
      alertId: "alert-firing",
      dedupeKey: JSON.stringify(["fingerprint-1", 100]),
    });
    expect(tables.fixes[0]?.alertIds).toEqual(["alert-firing"]);
    expect(tables.alertmanagerEvents.map((event) => event.createdAlertIds)).toEqual([
      ["alert-firing"],
      ["alert-firing"],
    ]);
  });
});
