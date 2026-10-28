import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";

import http from "./http";
import { complete, completeBatch } from "./investigationJobs";

function handler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
}

function fixture(statuses = ["firing"]) {
  const memberIds = statuses.map((_, i) => `alert-${i + 1}`);
  const tables: Record<string, Record<string, unknown>> = {
    "job-1": {
      _id: "job-1",
      alertId: "alert-1",
      sourceEventId: "event-1",
      status: "claimed",
      claimToken: "claim-1",
      claimedBy: "test-worker",
      claimedAt: 100,
      leaseUntil: 1000,
      attempts: 2,
      maxAttempts: 5,
      nextAttemptAt: 90,
      lastError: "earlier failure",
      errorHistory: [{ at: 90, phase: "probe", error: "earlier failure", retryable: true }],
      createdAt: 50,
      updatedAt: 100,
    },
    "event-1": { _id: "event-1", investigationAlertIds: memberIds },
  };
  for (const [index, id] of memberIds.entries()) {
    tables[id] = {
      _id: id,
      timestamp: 50,
      alertname: "TestAlert",
      severity: "warning",
      namespace: "test",
      status: statuses[index],
      outcome: "pending",
      summary: "Original summary",
      action: "Original action",
      rootCause: "Original cause",
      messaged: true,
      sourceEventId: "event-1",
      labels: { component: "example" },
      annotations: { description: "Example alert" },
      occurrenceCount: 3,
    };
  }
  const patches: string[] = [];
  const ctx = {
    db: {
      get: async (id: string) => tables[id] ?? null,
      // Deliberately no rollback: rejection must occur before even the first patch.
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push(id);
        Object.assign(tables[id], patch);
      },
    },
  };
  const results = memberIds.map((alertId) => ({
    alertId,
    outcome: "recorded",
    summary: "New summary",
    action: "Investigated",
    rootCause: "New cause",
    messaged: false,
  }));
  const args = { id: "job-1", claimToken: "claim-1", now: 500, results };
  return { tables, patches, ctx, args };
}

async function expectBlocked(f: ReturnType<typeof fixture>, mutation = completeBatch) {
  const before = structuredClone(f.tables);
  await expect(handler(mutation)(f.ctx, f.args)).rejects.toMatchObject({
    data: { code: "INVESTIGATION_MEMBERS_UNRESOLVED" },
  });
  expect(f.patches).toEqual([]);
  expect(f.tables).toEqual(before);
}

describe("investigation completion resolution gate", () => {
  for (const outcome of ["noise", "recorded", "fixed", "escalated"]) {
    test(`rejects firing single alert despite ${outcome}, then accepts resolution`, async () => {
      const f = fixture();
      f.args.results[0].outcome = outcome;
      f.tables["alert-1"].outcome = outcome;
      await expectBlocked(f);
      f.tables["alert-1"].status = "resolved";
      f.tables["alert-1"].resolvedAt = 400;
      await handler(completeBatch)(f.ctx, f.args);
      expect(f.tables["job-1"]).toMatchObject({ status: "done", completedAt: 500 });
      expect(f.tables["job-1"].claimToken).toBeUndefined();
      expect(f.tables["job-1"].errorHistory).toEqual([
        { at: 90, phase: "probe", error: "earlier failure", retryable: true },
      ]);
      expect(f.tables["alert-1"]).toMatchObject({ status: "resolved", resolvedAt: 400, outcome });
    });
  }

  test("mixed batch validates the last sibling before writing any result", async () => {
    const f = fixture(["resolved", "resolved", "firing"]);
    // Membership is the original snapshot, not the alerts' latest event linkage.
    f.tables["alert-3"].sourceEventId = "event-2";
    f.tables["alert-3"].ownerDisposition = "noise";
    f.tables["alert-3"].ownerNote = "Keep owner decision";
    await expectBlocked(f);
    f.tables["alert-3"].status = "resolved";
    const ownerAlert = structuredClone(f.tables["alert-3"]);
    await handler(completeBatch)(f.ctx, f.args);
    expect(f.tables["alert-3"]).toEqual(ownerAlert);
    expect(f.tables["alert-1"].summary).toBe("New summary");
    expect(f.tables["alert-2"].summary).toBe("New summary");
    expect(f.tables["job-1"].status).toBe("done");
  });

  for (const statuses of [["firing"], ["resolved", "firing"]]) {
    test(`direct internal complete cannot bypass ${statuses.join("/")} gate`, async () => {
      const f = fixture(statuses);
      await expectBlocked(f, complete);
      for (const result of f.args.results) f.tables[result.alertId].status = "resolved";
      const alertsBefore = f.args.results.map((r) => structuredClone(f.tables[r.alertId]));
      await handler(complete)(f.ctx, f.args);
      expect(f.tables["job-1"].status).toBe("done");
      expect(f.args.results.map((r) => f.tables[r.alertId])).toEqual(alertsBefore);
    });
  }

  test("legacy event without membership falls back to representative alert", async () => {
    const f = fixture();
    delete f.tables["event-1"].investigationAlertIds;
    await expectBlocked(f);
    await expectBlocked(f, complete);
    f.tables["alert-1"].status = "resolved";
    await handler(completeBatch)(f.ctx, f.args);
    expect(f.tables["job-1"].status).toBe("done");
  });

  test("reports every unresolved member and rejects unknown lifecycle states", async () => {
    const f = fixture(["firing", "resolved", "unknown"]);
    await expect(handler(completeBatch)(f.ctx, f.args)).rejects.toMatchObject({
      data: {
        code: "INVESTIGATION_MEMBERS_UNRESOLVED",
        unresolvedAlertIds: ["alert-1", "alert-3"],
      },
    });
    expect(f.patches).toEqual([]);
  });

  test("missing member is rejected before any patches", async () => {
    const f = fixture(["resolved", "resolved"]);
    delete f.tables["alert-2"];
    const before = structuredClone(f.tables);
    await expect(handler(completeBatch)(f.ctx, f.args)).rejects.toThrow("alert not found");
    expect(f.patches).toEqual([]);
    expect(f.tables).toEqual(before);
  });

  for (const mutation of [complete, completeBatch]) {
    test(`preserves claim authorization for ${mutation === complete ? "complete" : "completeBatch"}`, async () => {
      const f = fixture(["resolved"]);
      f.args.claimToken = "wrong-token";
      const before = structuredClone(f.tables);
      await expect(handler(mutation)(f.ctx, f.args)).rejects.toThrow(
        "job is not claimed by this token",
      );
      expect(f.patches).toEqual([]);
      expect(f.tables).toEqual(before);
    });
  }

  for (const invalid of ["missing", "duplicate", "unexpected", "pending"]) {
    test(`preserves ${invalid} batch validation without writes`, async () => {
      const f = fixture(["resolved", "resolved"]);
      if (invalid === "missing") f.args.results.pop();
      if (invalid === "duplicate") f.args.results[1].alertId = "alert-1";
      if (invalid === "unexpected") f.args.results[1].alertId = "alert-other";
      if (invalid === "pending") f.args.results[1].outcome = "pending";
      const before = structuredClone(f.tables);
      await expect(handler(completeBatch)(f.ctx, f.args)).rejects.toThrow(
        invalid === "pending" ? "pending is not terminal" : "every firing alert",
      );
      expect(f.patches).toEqual([]);
      expect(f.tables).toEqual(before);
    });
  }
});

describe("HTTP completion resolution gate", () => {
  let previousToken: string | undefined;
  beforeEach(() => {
    previousToken = process.env.COWTAIL_WORKER_TOKEN;
    process.env.COWTAIL_WORKER_TOKEN = "completion-test-token";
  });
  afterEach(() => {
    if (previousToken === undefined) delete process.env.COWTAIL_WORKER_TOKEN;
    else process.env.COWTAIL_WORKER_TOKEN = previousToken;
  });

  async function request(f: ReturnType<typeof fixture>, payload: Record<string, unknown>) {
    const route = http.lookup("/api/investigation-jobs/job-1/complete", "POST")!;
    const invoke = (
      route[0] as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>;
      }
    )._handler;
    return await invoke(
      {
        runQuery: async () => f.tables["job-1"],
        runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
          expect(getFunctionName(ref)).toBe("investigationJobs:completeBatch");
          try {
            return await handler(completeBatch)(f.ctx, args);
          } catch (error) {
            // Simulate Convex transporting structured application error data.
            if (error instanceof ConvexError) throw new ConvexError(structuredClone(error.data));
            throw error;
          }
        },
      },
      new Request("https://cowtail.example.com/api/investigation-jobs/job-1/complete", {
        method: "POST",
        headers: {
          authorization: "Bearer completion-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ claimToken: "claim-1", ...payload }),
      }),
    );
  }

  for (const format of ["legacy", "batch"]) {
    for (const outcome of ["noise", "recorded", "fixed", "escalated"]) {
      test(`${format} ${outcome} returns safe 409 without writes, then 200 after resolution`, async () => {
        const f = fixture();
        f.args.results[0].outcome = outcome;
        const payload = format === "batch" ? { results: f.args.results } : f.args.results[0];
        const before = structuredClone(f.tables);
        const blocked = await request(f, payload);
        expect(blocked.status).toBe(409);
        expect(await blocked.json()).toEqual({
          ok: false,
          error: "Investigation completion requires every member alert to be resolved",
          code: "INVESTIGATION_MEMBERS_UNRESOLVED",
          unresolvedAlertIds: ["alert-1"],
        });
        expect(f.patches).toEqual([]);
        expect(f.tables).toEqual(before);
        f.tables["alert-1"].status = "resolved";
        const accepted = await request(f, payload);
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toEqual({ ok: true, completedAlertCount: 1 });
        expect(f.tables["job-1"].status).toBe("done");
        expect(f.tables["alert-1"].outcome).toBe(outcome);
      });
    }
  }

  test("mixed HTTP batch rejects without partial writes and succeeds after sibling resolves", async () => {
    const f = fixture(["resolved", "firing"]);
    const before = structuredClone(f.tables);
    const blocked = await request(f, { results: f.args.results });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).unresolvedAlertIds).toEqual(["alert-2"]);
    expect(f.patches).toEqual([]);
    expect(f.tables).toEqual(before);
    f.tables["alert-2"].status = "resolved";
    expect((await request(f, { results: f.args.results })).status).toBe(200);
    expect(f.tables["job-1"].status).toBe("done");
  });

  test("legacy payload cannot omit resolved batch siblings", async () => {
    const f = fixture(["resolved", "resolved"]);
    const before = structuredClone(f.tables);
    expect((await request(f, f.args.results[0])).status).toBe(409);
    expect(f.patches).toEqual([]);
    expect(f.tables).toEqual(before);
  });
});
