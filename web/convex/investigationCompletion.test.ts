import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  type Backend,
  newBackend,
  request as httpRequest,
  row as getRow,
  rows,
  seedInvestigation,
  stubEnv,
} from "../test/convexHarness";

type Result = {
  alertId: Id<"alerts">;
  outcome: string;
  summary: string;
  action: string;
  rootCause?: string;
  messaged: boolean;
};
type CompletionArgs = {
  id: Id<"investigationJobs">;
  claimToken: string;
  now: number;
  results: Result[];
};

// The generated api predates this module; Convex resolves it by name.
const completeBatch = makeFunctionReference<"mutation", CompletionArgs>(
  "investigationJobs:completeBatch",
);
const completeRef = makeFunctionReference<"mutation", Omit<CompletionArgs, "results">>(
  "investigationJobs:complete",
);
type Completion = typeof completeBatch | typeof completeRef;

// `complete` takes no results; it only closes the job.
function run(t: Backend, mutation: Completion, args: CompletionArgs) {
  if (mutation === completeBatch) return t.mutation(completeBatch, args);
  const { results: _results, ...jobArgs } = args;
  return t.mutation(completeRef, jobArgs);
}

async function fixture(t: Backend, statuses = ["firing"]) {
  const { alertIds, jobId } = await seedInvestigation(t, {
    alerts: statuses.map((status) => ({
      status,
      rootCause: "Original cause",
      messaged: true,
      labels: { component: "example" },
      annotations: { description: "Example alert" },
      occurrenceCount: 3,
    })),
    job: {
      lastError: "earlier failure",
      errorHistory: [{ at: 90, phase: "probe", error: "earlier failure", retryable: true }],
    },
  });
  const results: Result[] = alertIds.map((alertId) => ({
    alertId,
    outcome: "recorded",
    summary: "New summary",
    action: "Investigated",
    rootCause: "New cause",
    messaged: false,
  }));
  const args: CompletionArgs = { id: jobId, claimToken: "claim-1", now: 500, results };
  return { alertIds, jobId, args };
}

async function snapshot(t: Backend) {
  return {
    alerts: await rows(t, "alerts"),
    jobs: await rows(t, "investigationJobs"),
    items: await rows(t, "items"),
  };
}

const patchAlert = (t: Backend, id: Id<"alerts">, patch: Record<string, unknown>) =>
  t.run((ctx) => ctx.db.patch(id, patch));

async function expectBlocked(
  t: Backend,
  args: CompletionArgs,
  mutation: Completion = completeBatch,
) {
  const before = await snapshot(t);
  await expect(run(t, mutation, args)).rejects.toMatchObject({
    data: { code: "INVESTIGATION_MEMBERS_UNRESOLVED" },
  });
  expect(await snapshot(t)).toEqual(before);
}

describe("investigation completion resolution gate", () => {
  for (const outcome of ["noise", "recorded", "fixed", "escalated"]) {
    test(`rejects firing single alert despite ${outcome}, then accepts resolution`, async () => {
      const t = newBackend();
      const f = await fixture(t);
      f.args.results[0].outcome = outcome;
      await patchAlert(t, f.alertIds[0], { outcome });
      await expectBlocked(t, f.args);
      await patchAlert(t, f.alertIds[0], { status: "resolved", resolvedAt: 400 });
      await t.mutation(completeBatch, f.args);
      const job = await getRow(t, f.jobId);
      expect(job).toMatchObject({ status: "done", completedAt: 500 });
      expect(job?.claimToken).toBeUndefined();
      expect(job?.errorHistory).toEqual([
        { at: 90, phase: "probe", error: "earlier failure", retryable: true },
      ]);
      expect(await getRow(t, f.alertIds[0])).toMatchObject({
        status: "resolved",
        resolvedAt: 400,
        outcome,
      });
    });
  }

  test("mixed batch validates the last sibling before writing any result", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved", "resolved", "firing"]);
    // Membership is the original snapshot, not the alerts' latest event linkage.
    await patchAlert(t, f.alertIds[2], {
      sourceEventId: undefined,
      ownerDisposition: "noise",
      ownerNote: "Keep owner decision",
    });
    await expectBlocked(t, f.args);
    await patchAlert(t, f.alertIds[2], { status: "resolved" });
    const ownerAlert = await getRow(t, f.alertIds[2]);
    await t.mutation(completeBatch, f.args);
    expect(await getRow(t, f.alertIds[2])).toEqual(ownerAlert);
    expect((await getRow(t, f.alertIds[0]))?.summary).toBe("New summary");
    expect((await getRow(t, f.alertIds[1]))?.summary).toBe("New summary");
    expect((await getRow(t, f.jobId))?.status).toBe("done");
  });

  for (const statuses of [["firing"], ["resolved", "firing"]]) {
    test(`direct internal complete cannot bypass ${statuses.join("/")} gate`, async () => {
      const t = newBackend();
      const f = await fixture(t, statuses);
      await expectBlocked(t, f.args, completeRef);
      for (const id of f.alertIds) await patchAlert(t, id, { status: "resolved" });
      const alertsBefore = await rows(t, "alerts");
      await run(t, completeRef, f.args);
      expect((await getRow(t, f.jobId))?.status).toBe("done");
      expect(await rows(t, "alerts")).toEqual(alertsBefore);
    });
  }

  test("legacy event without membership falls back to representative alert", async () => {
    const t = newBackend();
    const f = await fixture(t);
    const job = await getRow(t, f.jobId);
    await t.run((ctx) => ctx.db.patch(job!.sourceEventId, { investigationAlertIds: undefined }));
    await expectBlocked(t, f.args);
    await expectBlocked(t, f.args, completeRef);
    await patchAlert(t, f.alertIds[0], { status: "resolved" });
    await t.mutation(completeBatch, f.args);
    expect((await getRow(t, f.jobId))?.status).toBe("done");
  });

  test("reports every unresolved member and rejects unknown lifecycle states", async () => {
    const t = newBackend();
    const f = await fixture(t, ["firing", "resolved", "unknown"]);
    const before = await snapshot(t);
    await expect(t.mutation(completeBatch, f.args)).rejects.toMatchObject({
      data: {
        code: "INVESTIGATION_MEMBERS_UNRESOLVED",
        unresolvedAlertIds: [f.alertIds[0], f.alertIds[2]],
      },
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test("missing member is rejected before any patches", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved", "resolved"]);
    await t.run((ctx) => ctx.db.delete(f.alertIds[1]));
    const before = await snapshot(t);
    await expect(t.mutation(completeBatch, f.args)).rejects.toThrow("alert not found");
    expect(await snapshot(t)).toEqual(before);
  });

  for (const [name, mutation] of [
    ["complete", completeRef],
    ["completeBatch", completeBatch],
  ] as const) {
    test(`preserves claim authorization for ${name}`, async () => {
      const t = newBackend();
      const f = await fixture(t, ["resolved"]);
      f.args.claimToken = "wrong-token";
      const before = await snapshot(t);
      await expect(run(t, mutation, f.args)).rejects.toThrow("job is not claimed by this token");
      expect(await snapshot(t)).toEqual(before);
    });
  }

  for (const invalid of ["missing", "duplicate", "unexpected", "pending"]) {
    test(`preserves ${invalid} batch validation without writes`, async () => {
      const t = newBackend();
      const f = await fixture(t, ["resolved", "resolved"]);
      const outsider = await t.run((ctx) =>
        ctx.db.insert("alerts", {
          timestamp: 50,
          alertname: "Outsider",
          severity: "warning",
          namespace: "test",
          status: "resolved",
          outcome: "pending",
          summary: "Not in the batch",
          action: "None",
          messaged: false,
        }),
      );
      if (invalid === "missing") f.args.results.pop();
      if (invalid === "duplicate") f.args.results[1].alertId = f.alertIds[0];
      if (invalid === "unexpected") f.args.results[1].alertId = outsider;
      if (invalid === "pending") f.args.results[1].outcome = "pending";
      const before = await snapshot(t);
      await expect(t.mutation(completeBatch, f.args)).rejects.toThrow(
        invalid === "pending" ? "pending is not terminal" : "every firing alert",
      );
      expect(await snapshot(t)).toEqual(before);
    });
  }
});

async function request(
  t: Backend,
  f: Awaited<ReturnType<typeof fixture>>,
  payload: Record<string, unknown>,
) {
  return await httpRequest(t, `/api/investigation-jobs/${f.jobId}/complete`, {
    method: "POST",
    bearer: "completion-test-token",
    body: { claimToken: "claim-1", ...payload },
  });
}

describe("HTTP completion resolution gate", () => {
  beforeEach(() => {
    stubEnv({ COWTAIL_WORKER_TOKEN: "completion-test-token" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const format of ["legacy", "batch"]) {
    for (const outcome of ["noise", "recorded", "fixed", "escalated"]) {
      test(`${format} ${outcome} returns safe 409 without writes, then 200 after resolution`, async () => {
        const t = newBackend();
        const f = await fixture(t);
        f.args.results[0].outcome = outcome;
        const payload = format === "batch" ? { results: f.args.results } : f.args.results[0];
        const before = await snapshot(t);
        const blocked = await request(t, f, payload);
        expect(blocked.status).toBe(409);
        expect(blocked.json).toEqual({
          ok: false,
          error: "Investigation completion requires every member alert to be resolved",
          code: "INVESTIGATION_MEMBERS_UNRESOLVED",
          unresolvedAlertIds: [f.alertIds[0]],
        });
        expect(await snapshot(t)).toEqual(before);
        await patchAlert(t, f.alertIds[0], { status: "resolved" });
        const accepted = await request(t, f, payload);
        expect(accepted.status).toBe(200);
        expect(accepted.json).toEqual({ ok: true, completedAlertCount: 1 });
        expect((await getRow(t, f.jobId))?.status).toBe("done");
        expect((await getRow(t, f.alertIds[0]))?.outcome).toBe(outcome);
      });
    }
  }

  test("mixed HTTP batch rejects without partial writes and succeeds after sibling resolves", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved", "firing"]);
    const before = await snapshot(t);
    const blocked = await request(t, f, { results: f.args.results });
    expect(blocked.status).toBe(409);
    expect((blocked.json as { unresolvedAlertIds: string[] }).unresolvedAlertIds).toEqual([
      f.alertIds[1],
    ]);
    expect(await snapshot(t)).toEqual(before);
    await patchAlert(t, f.alertIds[1], { status: "resolved" });
    expect((await request(t, f, { results: f.args.results })).status).toBe(200);
    expect((await getRow(t, f.jobId))?.status).toBe("done");
  });

  test("legacy payload cannot omit resolved batch siblings", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved", "resolved"]);
    const before = await snapshot(t);
    expect((await request(t, f, f.args.results[0])).status).toBe(409);
    expect(await snapshot(t)).toEqual(before);
  });
});

describe("HTTP completion evidence", () => {
  beforeEach(() => {
    stubEnv({ COWTAIL_WORKER_TOKEN: "completion-test-token" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const evidence = [
    {
      step: "Read the last termination state",
      command: "kubectl -n media describe pod transcoder-7d9f",
      output: "Reason: OOMKilled",
      at: 450,
    },
    { step: "Raise the limit in GitOps and wait for rollout" },
  ];

  async function hermesUpdates(t: Backend) {
    return (await rows(t, "itemEvents")).filter((event) => event.type === "hermes_update");
  }

  for (const format of ["legacy", "batch"]) {
    test(`${format} completion stores evidence on the item's hermes_update`, async () => {
      const t = newBackend();
      const f = await fixture(t, ["resolved"]);
      const result = { ...f.args.results[0], evidence };
      const payload = format === "batch" ? { results: [result] } : result;

      expect((await request(t, f, payload)).status).toBe(200);

      expect((await hermesUpdates(t)).map((event) => event.payload)).toEqual([
        { text: "New summary", evidence },
      ]);
    });
  }

  test("cuts an output over 4 KB and marks the cut", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved"]);
    const step = { step: "Dump the logs", output: "x".repeat(5_000) };

    await request(t, f, { results: [{ ...f.args.results[0], evidence: [step] }] });

    const [update] = await hermesUpdates(t);
    expect(update?.payload.evidence?.[0].output).toBe(`${"x".repeat(4_096)}\n… [output truncated]`);
  });

  test("rejects more than 20 steps without writing", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved"]);
    const steps = Array.from({ length: 21 }, (_, index) => ({ step: `Step ${index + 1}` }));
    const before = await snapshot(t);

    const response = await request(t, f, { results: [{ ...f.args.results[0], evidence: steps }] });

    expect(response.status).toBe(400);
    expect(await snapshot(t)).toEqual(before);
  });

  test("completion without evidence records the summary alone", async () => {
    const t = newBackend();
    const f = await fixture(t, ["resolved"]);

    expect((await request(t, f, { results: f.args.results })).status).toBe(200);

    expect((await hermesUpdates(t)).map((event) => event.payload)).toEqual([
      { text: "New summary" },
    ]);
  });
});
