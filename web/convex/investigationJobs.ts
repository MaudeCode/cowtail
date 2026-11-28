import { internalMutation, internalQuery } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { patchAlert } from "./alerts";
import { recordAlertDispatch, recordAlertHermesUpdate } from "./items";

const executionValidator = v.object({
  deliveryId: v.id("jobDeliveries"),
  admissionId: v.string(),
  sessionId: v.string(),
  generation: v.number(),
});

const EVIDENCE_OUTPUT_LIMIT_BYTES = 4096;
const EVIDENCE_TRUNCATED_MARKER = "\n… [output truncated]";

// Keeps the first 4 KB of a step's output and marks the cut.
function truncateOutput(output: string) {
  const bytes = new TextEncoder().encode(output);
  if (bytes.length <= EVIDENCE_OUTPUT_LIMIT_BYTES) return output;
  // A cut through a multi-byte character decodes to U+FFFD; drop it.
  const kept = new TextDecoder().decode(bytes.slice(0, EVIDENCE_OUTPUT_LIMIT_BYTES));
  return kept.replace(/\uFFFD$/, "") + EVIDENCE_TRUNCATED_MARKER;
}

const evidenceStepValidator = v.object({
  step: v.string(),
  command: v.optional(v.string()),
  output: v.optional(v.string()),
  at: v.optional(v.number()),
});

async function investigationMemberIds(ctx: MutationCtx, job: Doc<"investigationJobs">) {
  const sourceEvent = await ctx.db.get(job.sourceEventId);
  return sourceEvent?.investigationAlertIds ?? [job.alertId];
}

async function resolvedMembers(ctx: MutationCtx, memberIds: Id<"alerts">[]) {
  // Read the immutable membership and current statuses in the completion transaction.
  // Outcomes and owner dispositions never substitute for lifecycle resolution.
  const alerts = await Promise.all(
    memberIds.map(async (id) => {
      const alert = await ctx.db.get(id);
      if (!alert) throw new Error("alert not found");
      return alert;
    }),
  );
  const unresolvedAlertIds = alerts
    .filter((alert) => alert.status !== "resolved")
    .map((alert) => alert._id);
  if (unresolvedAlertIds.length > 0) {
    throw new ConvexError({
      code: "INVESTIGATION_MEMBERS_UNRESOLVED",
      unresolvedAlertIds,
    });
  }
  return alerts;
}

const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("deadletter"),
);

const priorityValidator = v.union(v.literal("low"), v.literal("normal"), v.literal("high"));

const errorEntryValidator = v.object({
  at: v.number(),
  phase: v.string(),
  error: v.string(),
  retryable: v.boolean(),
});

export const createOrCoalesceForAlert = internalMutation({
  args: {
    alertId: v.id("alerts"),
    sourceEventId: v.id("alertmanagerEvents"),
    fingerprint: v.string(),
    dedupeKey: v.string(),
    alertStatus: v.string(),
    severity: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.alertStatus !== "firing") {
      return null;
    }

    const jobs = await ctx.db
      .query("investigationJobs")
      .withIndex("by_alertId", (q) => q.eq("alertId", args.alertId))
      .collect();
    const queued = jobs.find((job) => job.status === "queued");
    if (queued) {
      await ctx.db.patch(queued._id, {
        sourceEventId: args.sourceEventId,
        updatedAt: args.now,
      });
      return queued._id;
    }

    const jobId = await ctx.db.insert("investigationJobs", {
      alertId: args.alertId,
      sourceEventId: args.sourceEventId,
      fingerprint: args.fingerprint,
      dedupeKey: args.dedupeKey,
      status: "queued",
      priority: args.severity === "critical" ? "high" : "normal",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: args.now,
      errorHistory: [],
      createdAt: args.now,
      updatedAt: args.now,
    });
    await recordAlertDispatch(ctx, args.alertId, jobId, args.now);
    return jobId;
  },
});

export const claim = internalMutation({
  args: {
    jobId: v.optional(v.id("investigationJobs")),
    workerId: v.string(),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    execution: v.optional(executionValidator),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = args.jobId
      ? await ctx.db.get(args.jobId)
      : await ctx.db
          .query("investigationJobs")
          .withIndex("by_status_nextAttemptAt", (q) =>
            q.eq("status", "queued").lte("nextAttemptAt", args.now),
          )
          .first();

    if (
      !job ||
      job.status !== "queued" ||
      job.nextAttemptAt > args.now ||
      job.attempts >= job.maxAttempts
    ) {
      return null;
    }

    if (args.execution) {
      const delivery = await ctx.db.get(args.execution.deliveryId);
      if (!delivery || delivery.jobId !== job._id || (delivery.jobAttempts ?? 0) !== job.attempts)
        return null;
    }
    if (job.recoveryPending) {
      if (
        !args.execution ||
        args.execution.admissionId === job.recoveryFrom?.admissionId ||
        args.execution.sessionId === job.recoveryFrom?.sessionId ||
        (await recoveryHeld(ctx, job))
      )
        return null;
    }

    await ctx.db.patch(job._id, {
      status: "claimed",
      execution: args.execution,
      claimedBy: args.workerId,
      claimToken: args.claimToken,
      claimedAt: args.now,
      leaseUntil: args.now + args.leaseSeconds * 1000,
      attempts: job.attempts + 1,
      updatedAt: args.now,
    });

    return await ctx.db.get(job._id);
  },
});

export const renew = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "claimed" || job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }
    const leaseUntil = args.now + args.leaseSeconds * 1000;
    await ctx.db.patch(args.id, { leaseUntil, updatedAt: args.now });
    return { leaseUntil };
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "claimed" || job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }
    if (job.recoveryPending)
      throw new Error("reconcile prior execution before completing this job");
    await resolvedMembers(ctx, await investigationMemberIds(ctx, job));
    await ctx.db.patch(args.id, {
      status: "done",
      completedAt: args.now,
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      updatedAt: args.now,
    });
    return { ok: true };
  },
});

export const completeBatch = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    results: v.array(
      v.object({
        alertId: v.id("alerts"),
        outcome: v.string(),
        summary: v.string(),
        action: v.string(),
        rootCause: v.optional(v.string()),
        messaged: v.boolean(),
        // At most 20 steps; the HTTP route refuses more.
        evidence: v.optional(v.array(evidenceStepValidator)),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "claimed" || job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }

    if (job.recoveryPending)
      throw new Error("reconcile prior execution before completing this job");
    const memberIds = await investigationMemberIds(ctx, job);
    const expected = new Set(memberIds.map(String));
    const received = new Set(args.results.map((result) => String(result.alertId)));
    if (args.results.some((result) => result.outcome === "pending")) {
      throw new Error("batch results require terminal outcomes; pending is not terminal");
    }
    if (
      received.size !== args.results.length ||
      received.size !== expected.size ||
      [...expected].some((alertId) => !received.has(alertId))
    ) {
      throw new Error(
        "batch results must cover every firing alert in the source event exactly once",
      );
    }

    // Validate every member before the first write, including owner-disposition alerts.
    const alerts = await resolvedMembers(ctx, memberIds);
    const byId = new Map(alerts.map((alert) => [String(alert._id), alert]));
    for (const result of args.results) {
      const alert = byId.get(String(result.alertId))!;
      if (!alert.ownerDisposition) {
        await patchAlert(
          ctx,
          result.alertId,
          {
            outcome: result.outcome,
            summary: result.summary,
            action: result.action,
            rootCause: result.rootCause,
            messaged: result.messaged,
          },
          { actor: "hermes", now: args.now },
        );
      }
      // The owner's call stands, but what Hermes found still goes on the item's timeline.
      await recordAlertHermesUpdate(ctx, result.alertId, args.now, {
        text: result.summary,
        evidence: result.evidence?.map((step) =>
          step.output === undefined ? step : { ...step, output: truncateOutput(step.output) },
        ),
      });
    }

    await ctx.db.patch(args.id, {
      status: "done",
      completedAt: args.now,
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      updatedAt: args.now,
    });
    return { ok: true, completedAlertCount: args.results.length };
  },
});

async function enqueueClaimRetry(ctx: MutationCtx, job: Doc<"investigationJobs">, now: number) {
  const delay = Math.min(60 * 60 * 1000, 60 * 1000 * 5 ** Math.max(job.attempts - 1, 0));
  const nextAttemptAt = now + delay;
  // A new delivery ID is required: Hermes deduplicates the previous request.
  await ctx.db.insert("jobDeliveries", {
    jobId: job._id,
    target: "hermes:cowtail-alert-job",
    status: "pending",
    attempts: 0,
    jobAttempts: job.attempts,
    nextAttemptAt,
    createdAt: now,
    updatedAt: now,
  });
  return nextAttemptAt;
}

async function recoveryHeld(ctx: MutationCtx, job: Doc<"investigationJobs">) {
  const event = await ctx.db.get(job.sourceEventId);
  if (!event || job.errorHistory.some((error) => !error.retryable)) return true;
  const members = await Promise.all(
    (event.investigationAlertIds ?? [job.alertId]).map((id) => ctx.db.get(id)),
  );
  return members.some((alert) => !alert || alert.ownerDisposition);
}

export const expiredExecutions = internalQuery({
  args: { now: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { now, cursor }) => {
    const page = await ctx.db
      .query("investigationJobs")
      .withIndex("by_status_leaseUntil", (q) =>
        q.eq("status", "claimed").gt("leaseUntil", 0).lte("leaseUntil", now),
      )
      .paginate({ cursor, numItems: 20 });
    return {
      cursor: page.isDone ? null : page.continueCursor,
      jobs: page.page.flatMap((job) =>
        job.execution ? [{ jobId: job._id, execution: job.execution }] : [],
      ),
    };
  },
});

export const recoverStoppedExecution = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    execution: executionValidator,
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    now: v.number(),
  },
  handler: async (ctx, { id, execution, outcome, now }) => {
    const job = await ctx.db.get(id);
    if (
      !job ||
      job.status !== "claimed" ||
      job.leaseUntil === undefined ||
      job.leaseUntil > now ||
      job.execution?.deliveryId !== execution.deliveryId ||
      job.execution.admissionId !== execution.admissionId ||
      job.execution.sessionId !== execution.sessionId ||
      job.execution.generation !== execution.generation ||
      (await recoveryHeld(ctx, job))
    ) {
      return { status: "unchanged" };
    }
    const exhausted = job.attempts >= job.maxAttempts;
    const error = exhausted
      ? `Hermes execution ${outcome} without settling the investigation; claim attempt limit reached`
      : `Hermes execution ${outcome} without settling the investigation; scheduling a replacement`;
    const nextAttemptAt = exhausted ? job.nextAttemptAt : await enqueueClaimRetry(ctx, job, now);
    // Holding the job read and writing both rows in one transaction fences duplicate reports,
    // renewals, owner dispositions and other terminal mutations.
    await ctx.db.patch(id, {
      status: exhausted ? "deadletter" : "queued",
      nextAttemptAt,
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      execution: undefined,
      recoveryPending: !exhausted,
      reconciliation: undefined,
      recoveryFrom: execution,
      lastError: error,
      errorHistory: [
        ...job.errorHistory,
        { at: now, phase: "execution-recovery", error, retryable: !exhausted },
      ],
      updatedAt: now,
      ...(exhausted ? { deadletteredAt: now, deadletterReason: error } : {}),
    });
    return { status: exhausted ? "deadletter" : "queued" };
  },
});

export const reconcileRecovery = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    priorEffects: v.string(),
    resourceOwnership: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, claimToken, priorEffects, resourceOwnership, now }) => {
    const job = await ctx.db.get(id);
    if (
      !job ||
      job.status !== "claimed" ||
      job.claimToken !== claimToken ||
      !job.recoveryPending ||
      !job.execution ||
      job.leaseUntil === undefined ||
      job.leaseUntil <= now ||
      (await recoveryHeld(ctx, job))
    )
      return { reconciled: false };
    await ctx.db.patch(id, {
      recoveryPending: false,
      reconciliation: { priorEffects, resourceOwnership, at: now },
      updatedAt: now,
    });
    return { reconciled: true };
  },
});

export const fail = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    claimToken: v.string(),
    phase: v.string(),
    error: v.string(),
    retryable: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) {
      throw new Error("job not found");
    }
    if (job.status !== "claimed" || job.claimToken !== args.claimToken) {
      throw new Error("job is not claimed by this token");
    }

    const errorHistory = [
      ...job.errorHistory,
      { at: args.now, phase: args.phase, error: args.error, retryable: args.retryable },
    ];
    const shouldRetry = args.retryable && job.attempts < job.maxAttempts;
    if (shouldRetry) {
      const nextAttemptAt = await enqueueClaimRetry(ctx, job, args.now);
      await ctx.db.patch(args.id, {
        status: "queued",
        execution: undefined,
        nextAttemptAt,
        claimedBy: undefined,
        claimToken: undefined,
        claimedAt: undefined,
        leaseUntil: undefined,
        lastError: args.error,
        errorHistory,
        updatedAt: args.now,
      });
      return { status: "queued" };
    }

    await ctx.db.patch(args.id, {
      status: "deadletter",
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      lastError: args.error,
      errorHistory,
      deadletteredAt: args.now,
      deadletterReason: args.error,
      updatedAt: args.now,
    });
    return { status: "deadletter" };
  },
});

export const requeue = internalMutation({
  args: {
    id: v.id("investigationJobs"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "queued",
      nextAttemptAt: args.now,
      attempts: 0,
      execution: undefined,
      recoveryPending: undefined,
      reconciliation: undefined,
      recoveryFrom: undefined,
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseUntil: undefined,
      lastError: undefined,
      errorHistory: [],
      completedAt: undefined,
      deadletteredAt: undefined,
      deadletterReason: undefined,
      updatedAt: args.now,
    });
    return { ok: true };
  },
});

export const getById = internalQuery({
  args: { id: v.id("investigationJobs") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const deadletters = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    return await ctx.db
      .query("investigationJobs")
      .withIndex("by_status_nextAttemptAt", (q) => q.eq("status", "deadletter"))
      .take(limit);
  },
});

export const deadlettersByTimeRange = internalQuery({
  args: {
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 500));
    const jobs = await ctx.db
      .query("investigationJobs")
      .withIndex("by_status_nextAttemptAt", (q) => q.eq("status", "deadletter"))
      .take(limit);
    return jobs.filter(
      (job) =>
        job.deadletteredAt !== undefined &&
        job.deadletteredAt >= args.from &&
        job.deadletteredAt <= args.to,
    );
  },
});

export { jobStatusValidator, priorityValidator, errorEntryValidator };
