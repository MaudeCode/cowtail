import { afterEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";

import * as deliveries from "./jobDeliveries";
import { deliverOne, retryDue } from "./jobDeliveryActions";
import { claim } from "./investigationJobs";

const run = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);
const GRACE = 5 * 60_000;

function fixture() {
  const rows: Record<string, any> = {
    job: {
      _id: "job",
      table: "investigationJobs",
      alertId: "alert",
      sourceEventId: "event",
      fingerprint: "fingerprint",
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: 0,
      createdAt: 0,
      errorHistory: [],
    },
    alert: { _id: "alert", alertname: "TestAlert", severity: "warning" },
    event: { _id: "event", investigationAlertIds: ["alert"] },
  };
  let sequence = 0;
  const ctx: any = {
    db: {
      get: async (id: string) => rows[id] ?? null,
      insert: async (table: string, value: any) => {
        const id = `delivery-${++sequence}`;
        rows[id] = { ...value, _id: id, _creationTime: sequence, table };
        return id;
      },
      patch: async (id: string, value: any) => Object.assign(rows[id], value),
      query: (table: string) => ({
        withIndex: (_name: string, apply: any) => {
          const predicates: ((row: any) => boolean)[] = [];
          const index: any = {
            eq: (key: string, value: any) => {
              predicates.push((row) => row[key] === value);
              return index;
            },
            lte: (key: string, value: number) => {
              predicates.push((row) => row[key] <= value);
              return index;
            },
          };
          apply(index);
          let direction = 1;
          const matches = () =>
            Object.values(rows)
              .filter((row) => row.table === table && predicates.every((p) => p(row)))
              .sort((a, b) => direction * (a._creationTime - b._creationTime));
          const result: any = {
            order: (value: string) => {
              direction = value === "desc" ? -1 : 1;
              return result;
            },
            first: async () => matches()[0] ?? null,
            take: async (n: number) => matches().slice(0, n),
            collect: async () => matches(),
          };
          return result;
        },
      }),
    },
    runMutation: async (ref: any, args: any) => {
      const name = getFunctionName(ref).split(":")[1];
      return run((deliveries as any)[name], ctx, args);
    },
    runQuery: async (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name.endsWith(":getById")) return rows[args.id];
      return run((deliveries as any)[name.split(":")[1]], ctx, args);
    },
  };
  const enqueue = (now = 0) => run(deliveries.enqueue, ctx, { jobId: "job", now });
  const acknowledge = (id: string, now = 0) =>
    run(deliveries.recordAttempt, ctx, { id, ok: true, statusCode: 202, now });
  const recover = (now: number) =>
    run((deliveries as any).recoverUnclaimed, ctx, { now, limit: 5 });
  const all = () => Object.values(rows).filter((row) => row.table === "jobDeliveries");
  return { rows, ctx, enqueue, acknowledge, recover, all };
}

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalUrl = process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL;
const originalToken = process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (originalUrl === undefined) delete process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL;
  else process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL = originalUrl;
  if (originalToken === undefined) delete process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN;
  else process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN = originalToken;
});

describe("accepted but unclaimed delivery recovery", () => {
  test("retry cron sends a fresh request ID after an ACK and pre-claim exit", async () => {
    const f = fixture();
    const sent: string[] = [];
    process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL = "https://example.invalid/webhook";
    process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN = "test-token";
    Date.now = () => 0;
    globalThis.fetch = (async (_url: any, options: any) => {
      const id = options.headers["x-request-id"];
      sent.push(id);
      return Response.json({ status: "accepted", delivery_id: id }, { status: 202 });
    }) as typeof fetch;
    const first = await f.enqueue();
    await run(deliverOne, f.ctx, { deliveryId: first });
    const original = { ...f.rows[first] };
    Date.now = () => GRACE - 1;
    await run(retryDue, f.ctx, {});
    expect(sent).toEqual([first]);
    Date.now = () => GRACE;
    await run(retryDue, f.ctx, {});
    expect(sent.length).toBe(2);
    expect(sent[1]).not.toBe(first);
    expect(f.rows[first]).toMatchObject({
      status: "delivered",
      attempts: original.attempts,
      lastAttemptAt: original.lastAttemptAt,
    });
    expect(f.rows[sent[1]].recoveredFrom).toBe(first);
    expect(f.rows.job.attempts).toBe(0);
    expect(f.rows.job.errorHistory).toHaveLength(1);
    // Repeating the sweep cannot create a second successor.
    await run(retryDue, f.ctx, {});
    expect(sent).toHaveLength(2);
    const args = {
      jobId: "job",
      workerId: "worker",
      claimToken: "claim",
      leaseSeconds: 900,
      now: GRACE,
    };
    expect(await run(claim, f.ctx, args)).not.toBeNull();
    expect(await run(claim, f.ctx, { ...args, workerId: "other" })).toBeNull();
    Date.now = () => GRACE + 60 * 60_000;
    await run(retryDue, f.ctx, {});
    expect(sent).toHaveLength(2);
    expect(f.rows.job.status).toBe("claimed");
  });

  test("bounds recovery, backs off, and preserves history on exhaustion", async () => {
    const f = fixture();
    f.rows.job.errorHistory = [
      { at: -1, phase: "previous", error: "previous failure", retryable: true },
    ];
    let id = await f.enqueue();
    let now = 0;
    for (const delay of [GRACE, 15 * 60_000, 60 * 60_000]) {
      await f.acknowledge(id, now);
      await f.recover(now + delay - 1);
      expect(f.all().at(-1)._id).toBe(id);
      now += delay;
      await f.recover(now);
      const next = f.all().at(-1);
      expect(next._id).not.toBe(id);
      id = next._id;
    }
    await f.acknowledge(id, now);
    await f.recover(now + 60 * 60_000);
    expect(f.rows.job.status).toBe("deadletter");
    expect(f.rows.job.attempts).toBe(0);
    expect(f.rows.job.errorHistory).toHaveLength(5);
    expect(f.rows.job.errorHistory[0].phase).toBe("previous");
    expect(f.rows.job.errorHistory.at(-1).retryable).toBe(false);
    await f.recover(now + 120 * 60_000);
    expect(f.all()).toHaveLength(4);
  });

  for (const status of ["claimed", "done", "failed", "deadletter"]) {
    test(`does not replay ${status} jobs`, async () => {
      const f = fixture();
      const id = await f.enqueue();
      await f.acknowledge(id);
      f.rows.job.status = status;
      f.rows.job.claimToken = "keep";
      const before = { ...f.rows.job };
      await f.recover(GRACE);
      expect(f.all()).toHaveLength(1);
      expect(f.rows.job).toEqual(before);
    });
  }

  test("does not override policy refusal, owner disposition, or a later claim", async () => {
    for (const reason of ["policy", "owner", "claim", "sibling"]) {
      const f = fixture();
      const id = await f.enqueue();
      await f.acknowledge(id);
      if (reason === "policy")
        f.rows.job.errorHistory.push({
          at: 1,
          phase: "policy",
          error: "blocked",
          retryable: false,
        });
      if (reason === "owner") f.rows.alert.ownerDisposition = "noise";
      if (reason === "claim") f.rows.job.attempts = 1;
      if (reason === "sibling") {
        f.rows.event.investigationAlertIds.push("sibling");
        f.rows.sibling = { ownerDisposition: "escalated" };
      }
      await f.recover(GRACE);
      expect(f.all()).toHaveLength(1);
    }
  });

  test("recovers legacy deliveries, but never a superseded delivery", async () => {
    const f = fixture();
    const id = await f.enqueue();
    await f.acknowledge(id);
    delete f.rows[id].claimCheckState;
    delete f.rows[id].jobAttempts;
    f.rows[id].nextAttemptAt = 0;
    await f.recover(GRACE - 1);
    expect(f.all()).toHaveLength(1);
    await f.recover(GRACE);
    expect(f.all()).toHaveLength(2);
    delete f.rows[id].claimCheckState;
    await f.recover(GRACE * 2);
    expect(f.all()).toHaveLength(2);
  });

  test("enqueue reuses the newest pending delivery and late failure cannot undo ACK", async () => {
    const f = fixture();
    const first = await f.enqueue();
    await f.acknowledge(first);
    const next = await run(deliveries.enqueue, f.ctx, { jobId: "job", now: 1, freshAttempt: true });
    expect(await f.enqueue(2)).toBe(next);
    await run(deliveries.recordAttempt, f.ctx, { id: first, ok: false, now: 3, error: "late" });
    expect(f.rows[first].status).toBe("delivered");
    expect(f.rows[first].attempts).toBe(1);
    expect(f.all()).toHaveLength(2);
  });

  test("coalesced notifications preserve the claim deadline and recovery budget", async () => {
    const f = fixture();
    let id = await f.enqueue();
    let now = 0;
    for (const delay of [GRACE, 15 * 60_000, 60 * 60_000, 60 * 60_000]) {
      await f.acknowledge(id, now);
      expect(await f.enqueue(now + 1)).toBe(id);
      expect(f.rows[id].nextAttemptAt).toBe(now + delay);
      now += delay;
      await f.recover(now);
      id = f.all().at(-1)._id;
    }
    expect(f.rows.job.status).toBe("deadletter");
    expect(f.all()).toHaveLength(4);
  });

  test("deferred jobs do not keep starving a ready delivery behind the batch", async () => {
    const f = fixture();
    Date.now = () => 0;
    process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL = "https://example.invalid/webhook";
    process.env.COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN = "test-token";
    const sent: string[] = [];
    globalThis.fetch = (async (_url: any, options: any) => {
      const id = options.headers["x-request-id"];
      sent.push(id);
      return Response.json({ status: "accepted", delivery_id: id }, { status: 202 });
    }) as typeof fetch;
    for (let i = 0; i < 5; i++) {
      const jobId = `blocked-${i}`;
      f.rows[jobId] = { ...f.rows.job, _id: jobId, nextAttemptAt: GRACE };
      const id = await run(deliveries.enqueue, f.ctx, { jobId, now: 0 });
      f.rows[id].nextAttemptAt = 0;
    }
    const ready = await f.enqueue();
    await run(retryDue, f.ctx, {});
    await run(retryDue, f.ctx, {});
    expect(sent).toEqual([ready]);
    expect(
      f
        .all()
        .slice(0, 5)
        .every((row) => row.nextAttemptAt === GRACE),
    ).toBe(true);
    // A repeated notification cannot cancel a transport backoff either.
    f.rows[ready].status = "pending";
    f.rows[ready].nextAttemptAt = GRACE;
    expect(await f.enqueue()).toBe(ready);
    expect(f.rows[ready].nextAttemptAt).toBe(GRACE);
  });
});
