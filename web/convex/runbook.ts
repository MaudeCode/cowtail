import { runbookOutputLimitBytes } from "@maudecode/cowtail-protocol";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendItemEvent } from "./items";
import {
  runbookCatalog,
  runbookConfirmText,
  runbookNeedsAuth,
  runbookRunRecord,
} from "./runbookModel";

const HERMES = "hermes";
const TRUNCATED_MARKER = "\n[Output truncated at 256 KB]\n";
const RERUN_MARKER = "\n[Hermes stopped before it started the script; starting it again]\n";
const LOST_MARKER =
  "\n[Hermes stopped reporting after the script started; it may or may not have finished]\n";
const EXCERPT_CHARS = 500;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- The owner's request ---------------------------------------------------------------

// Queues a run of a script from the latest catalog. A script that asks to confirm needs the
// owner's confirmation, and Face ID while the owner requires it for approvals. A run for an
// item starts on the item's timeline. A request sent again returns the run it queued.
export const requestRun = internalMutation({
  args: {
    requestId: v.string(),
    scriptId: v.string(),
    itemId: v.optional(v.string()),
    confirmed: v.optional(v.boolean()),
    authenticated: v.optional(v.boolean()),
    actor: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { requestId, scriptId, itemId, confirmed, authenticated, actor, now }) => {
    const queued = await ctx.db
      .query("runbookRuns")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .unique();
    if (queued) return runbookRunRecord(queued);

    const script = (await runbookCatalog(ctx)).find((entry) => entry.id === scriptId);
    if (!script) throw new ConvexError({ code: "UNKNOWN_SCRIPT" });
    if (runbookConfirmText(script) !== undefined && confirmed !== true) {
      throw new ConvexError({ code: "RUN_NEEDS_CONFIRM" });
    }
    if (authenticated !== true && (await runbookNeedsAuth(ctx, script))) {
      throw new ConvexError({ code: "RUN_NEEDS_AUTH" });
    }

    let item: Doc<"items"> | null = null;
    if (itemId !== undefined) {
      const id = ctx.db.normalizeId("items", itemId);
      item = id ? await ctx.db.get(id) : null;
      if (!item) throw new ConvexError({ code: "ITEM_NOT_FOUND" });
    }

    const runId = await ctx.db.insert("runbookRuns", {
      scriptId,
      scriptName: script.name,
      itemId: item?._id,
      requestedBy: actor,
      requestId,
      status: "queued",
      availableAt: now,
      attempts: 0,
      nextSeq: 0,
      outputChunks: 0,
      outputBytes: 0,
      truncated: false,
      createdAt: now,
      updatedAt: now,
    });
    if (item) {
      await appendItemEvent(ctx, item._id, "run_started", actor, now, {
        runId: String(runId),
        scriptId,
        scriptName: script.name,
      });
      await ctx.db.patch(item._id, { updatedAt: now });
    }
    return runbookRunRecord((await ctx.db.get(runId))!);
  },
});

async function runOutput(ctx: QueryCtx, runId: Id<"runbookRuns">) {
  const chunks = await ctx.db
    .query("runbookRunOutput")
    .withIndex("by_run_seq", (q) => q.eq("runId", runId))
    .collect();
  return chunks.map((chunk) => chunk.text).join("");
}

export const getRun = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("runbookRuns", args.id);
    const run = id ? await ctx.db.get(id) : null;
    if (!run) return null;
    return { run: runbookRunRecord(run), output: await runOutput(ctx, run._id) };
  },
});

// --- Hermes ------------------------------------------------------------------------------

async function insertOutput(ctx: MutationCtx, run: Doc<"runbookRuns">, text: string) {
  await ctx.db.insert("runbookRunOutput", { runId: run._id, seq: run.outputChunks, text });
  return run.outputChunks + 1;
}

// A running run whose lease ran out ends `unknown` once its script started, since it may have
// run; it is never run again without the owner. One that never started can be leased again.
async function settleLapsedRuns(ctx: MutationCtx, now: number) {
  const lapsed = await ctx.db
    .query("runbookRuns")
    .withIndex("by_status_availableAt", (q) => q.eq("status", "running").lte("availableAt", now))
    .collect();
  const releasable: Doc<"runbookRuns">[] = [];
  for (const run of lapsed) {
    if (run.executingAt === undefined) {
      releasable.push(run);
      continue;
    }
    const outputChunks = await insertOutput(ctx, run, LOST_MARKER);
    await ctx.db.patch(run._id, {
      status: "unknown",
      outputChunks,
      finishedAt: now,
      updatedAt: now,
    });
    await recordFinish(ctx, { ...run, outputChunks }, "unknown", now);
  }
  return releasable;
}

// Runs every minute, so a run Hermes stopped reporting ends even while no Hermes claims.
export const settleLapsed = internalMutation({
  args: {},
  handler: async (ctx) => {
    await settleLapsedRuns(ctx, Date.now());
  },
});

// Leases the oldest queued run, or a running one whose lease ran out before its script
// started. Each claim numbers its output batches from 0.
export const claimRun = internalMutation({
  args: {
    workerId: v.string(),
    claimToken: v.string(),
    leaseSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, { workerId, claimToken, leaseSeconds, now }) => {
    const releasable = await settleLapsedRuns(ctx, now);
    const run =
      (await ctx.db
        .query("runbookRuns")
        .withIndex("by_status_availableAt", (q) => q.eq("status", "queued").lte("availableAt", now))
        .first()) ?? releasable[0];
    if (!run) return null;

    const leaseMs = leaseSeconds * 1000;
    const outputChunks =
      run.status === "running" ? await insertOutput(ctx, run, RERUN_MARKER) : run.outputChunks;
    await ctx.db.patch(run._id, {
      status: "running",
      claimToken,
      claimedBy: workerId,
      leaseMs,
      availableAt: now + leaseMs,
      attempts: run.attempts + 1,
      nextSeq: 0,
      outputChunks,
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    return {
      id: String(run._id),
      scriptId: run.scriptId,
      claimToken,
      leaseUntil: now + leaseMs,
      attempts: run.attempts + 1,
    };
  },
});

async function claimedRun(ctx: MutationCtx, id: string, claimToken: string) {
  const runId = ctx.db.normalizeId("runbookRuns", id);
  const run = runId ? await ctx.db.get(runId) : null;
  if (!run) throw new ConvexError({ code: "RUN_NOT_FOUND" });
  // A lease that ran out and went to another claim no longer speaks for the run.
  if (run.status !== "running" || run.claimToken !== claimToken) {
    throw new ConvexError({ code: "RUN_NOT_CLAIMED" });
  }
  return run;
}

// The part of `text` that fits in `bytes` of UTF-8, never splitting a character.
function fitBytes(text: string, bytes: number) {
  return decoder.decode(encoder.encode(text).slice(0, bytes)).replace(/�+$/, "");
}

// Appends one batch in order and renews the lease. A batch sent again is stored once. Output
// past 256 KB is dropped after one truncation marker.
export const appendOutput = internalMutation({
  args: {
    id: v.string(),
    claimToken: v.string(),
    seq: v.number(),
    text: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, claimToken, seq, text, now }) => {
    const run = await claimedRun(ctx, id, claimToken);
    const renewed = { availableAt: now + (run.leaseMs ?? 0), updatedAt: now };
    if (seq < run.nextSeq) {
      await ctx.db.patch(run._id, renewed);
      return;
    }
    if (seq > run.nextSeq) throw new ConvexError({ code: "OUTPUT_OUT_OF_ORDER" });

    let { outputChunks, outputBytes, truncated } = run;
    const executingAt = run.executingAt ?? now;
    if (text && !truncated) {
      const size = encoder.encode(text).length;
      const room = runbookOutputLimitBytes - outputBytes;
      const kept = size <= room ? text : fitBytes(text, room);
      if (kept) outputChunks = await insertOutput(ctx, { ...run, outputChunks }, kept);
      outputBytes += encoder.encode(kept).length;
      if (size > room) {
        outputChunks = await insertOutput(ctx, { ...run, outputChunks }, TRUNCATED_MARKER);
        truncated = true;
      }
    }
    await ctx.db.patch(run._id, {
      ...renewed,
      executingAt,
      nextSeq: seq + 1,
      outputChunks,
      outputBytes,
      truncated,
    });
  },
});

// The run's last lines, for the item's timeline.
async function outputExcerpt(ctx: QueryCtx, runId: Id<"runbookRuns">) {
  const chunks = await ctx.db
    .query("runbookRunOutput")
    .withIndex("by_run_seq", (q) => q.eq("runId", runId))
    .order("desc")
    .take(20);
  return chunks
    .reverse()
    .map((chunk) => chunk.text)
    .join("")
    .slice(-EXCERPT_CHARS)
    .trim();
}

export const completeRun = internalMutation({
  args: { id: v.string(), claimToken: v.string(), exitCode: v.number(), now: v.number() },
  handler: async (ctx, { id, claimToken, exitCode, now }) => {
    const run = await claimedRun(ctx, id, claimToken);
    const status = exitCode === 0 ? "succeeded" : "failed";
    await ctx.db.patch(run._id, { status, exitCode, finishedAt: now, updatedAt: now });
    await recordFinish(ctx, run, status, now, exitCode);
  },
});

// A run for an item ends on the item's timeline, with its output's last lines.
async function recordFinish(
  ctx: MutationCtx,
  run: Doc<"runbookRuns">,
  status: "succeeded" | "failed" | "unknown",
  now: number,
  exitCode?: number,
) {
  if (!run.itemId || !(await ctx.db.get(run.itemId))) return;
  await appendItemEvent(ctx, run.itemId, "run_finished", HERMES, now, {
    runId: String(run._id),
    scriptId: run.scriptId,
    scriptName: run.scriptName,
    status,
    ...(exitCode === undefined ? {} : { exitCode }),
    excerpt: await outputExcerpt(ctx, run._id),
  });
  await ctx.db.patch(run.itemId, { updatedAt: now });
}

const RECENT_RUNS_LIMIT = 10;

export async function recentRuns(ctx: QueryCtx) {
  const runs = await ctx.db
    .query("runbookRuns")
    .withIndex("by_createdAt")
    .order("desc")
    .take(RECENT_RUNS_LIMIT);
  return runs.map(runbookRunRecord);
}
