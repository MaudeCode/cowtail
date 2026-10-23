import { describe, expect, test } from "bun:test";
import { fail } from "./investigationJobs";

const run = (fail as any)._handler;
function setup(attempts = 1) {
  const job: any = {
    _id: "job-1",
    status: "claimed",
    claimToken: "synthetic-token",
    claimedBy: "worker",
    claimedAt: 10,
    leaseUntil: 1000,
    attempts,
    maxAttempts: 5,
    errorHistory: [{ at: 1, phase: "prior", error: "prior", retryable: true }],
  };
  const deliveries: any[] = [
    {
      _id: "delivery-original",
      jobId: "job-1",
      status: "delivered",
      jobAttempts: 0,
      claimCheckState: "finished",
    },
  ];
  const ctx = {
    db: {
      get: async () => job,
      patch: async (_: string, p: any) => Object.assign(job, p),
      insert: async (table: string, row: any) => {
        expect(table).toBe("jobDeliveries");
        const id = `delivery-${deliveries.length}`;
        deliveries.push({ _id: id, ...row });
        return id;
      },
    },
  };
  return { job, deliveries, ctx };
}
const args = {
  id: "job-1",
  claimToken: "synthetic-token",
  phase: "dependency",
  error: "temporary",
  retryable: true,
  now: 100,
};
describe("post-claim durable retry", () => {
  test("retryable failure atomically queues a fresh delivery at job backoff", async () => {
    const { job, deliveries, ctx } = setup();
    await run(ctx, args);
    expect(job.status).toBe("queued");
    expect(job.nextAttemptAt).toBe(60100);
    expect(job.errorHistory).toHaveLength(2);
    expect(job.claimToken).toBeUndefined();
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toMatchObject({
      jobId: "job-1",
      target: "hermes:cowtail-alert-job",
      status: "pending",
      attempts: 0,
      jobAttempts: 1,
      nextAttemptAt: 60100,
    });
    expect(deliveries[1]._id).not.toBe(deliveries[0]._id);
  });
  test("later failure preserves exponential backoff and history", async () => {
    const { job, deliveries, ctx } = setup(3);
    await run(ctx, args);
    expect(job.attempts).toBe(3);
    expect(job.errorHistory).toHaveLength(2);
    expect(deliveries[1]?.nextAttemptAt).toBe(1500100);
  });
  test.each([false, true])(
    "terminal failure creates no fresh delivery, retryable=%s",
    async (retryable) => {
      const { job, deliveries, ctx } = setup(retryable ? 5 : 1);
      await run(ctx, { ...args, retryable });
      expect(job.status).toBe("deadletter");
      expect(deliveries).toHaveLength(1);
      expect(job.errorHistory).toHaveLength(2);
    },
  );
  test("replayed fail cannot create a second delivery after claim release", async () => {
    const { deliveries, ctx } = setup();
    await run(ctx, args);
    await expect(run(ctx, args)).rejects.toThrow("job is not claimed by this token");
    expect(deliveries).toHaveLength(2);
  });
});
