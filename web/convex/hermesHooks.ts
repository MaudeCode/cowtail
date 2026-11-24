import type { HermesHookPayload } from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { createItem, itemCreateValidator } from "./items";

const HOUR_MS = 60 * 60 * 1000;
// A provider error that repeats this often within an hour is a storm the owner sees today.
const ERROR_STORM_COUNT = 10;
// Hermes retries a delivery once, a second later; a day covers any redelivery.
const DELIVERY_RETENTION_MS = 24 * HOUR_MS;
const PRUNE_BATCH = 500;

type ItemRequest = Infer<typeof itemCreateValidator>;

// Identifiers are cut to 200 characters, so titles, dedupe keys and context values built
// from them stay inside the item limits in protocol/src/items.ts.
const ID_MAX = 200;
const BODY_MAX = 20_000;

function text(value: unknown, max = ID_MAX): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function definedContext(context: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(context).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * The item a Hermes hook event raises, or undefined for an event Cowtail ignores.
 * `errorStorm` marks a provider error, whose repeats can raise its urgency.
 */
export function hermesHookItem({
  hook_event_name: event,
  profile,
  extra: rawExtra,
}: HermesHookPayload): { item: ItemRequest; errorStorm: boolean } | undefined {
  const extra = rawExtra ?? {};
  const hermesProfile = text(extra.profile_name) ?? text(profile) ?? "default";
  const task = {
    task: text(extra.task_id),
    board: text(extra.board),
    assignee: text(extra.assignee),
    profile: hermesProfile,
  };

  switch (event) {
    case "kanban_task_blocked": {
      // Hermes sends the task id and the block reason; the task's own title stays in Hermes.
      const taskId = task.task ?? "unknown";
      return {
        item: {
          source: "hermes",
          kind: "question",
          urgency: "today",
          title: `Hermes task ${taskId} is blocked`,
          body: text(extra.reason, BODY_MAX) ?? "",
          context: definedContext(task),
          dedupeKey: `hermes-kanban:${taskId}`,
        },
        errorStorm: false,
      };
    }
    case "on_kanban_worker_exited": {
      if (extra.exit_kind !== "rate_limited") return undefined;
      const limited = text(extra.provider) ?? hermesProfile;
      return {
        item: {
          source: "hermes",
          kind: "failure",
          urgency: "today",
          title: `Hermes worker rate-limited on ${limited}`,
          body: task.task ? `Task ${task.task} stopped when its worker hit a rate limit.` : "",
          context: definedContext({ ...task, provider: text(extra.provider) }),
          dedupeKey: `hermes-ratelimit:${limited}`,
        },
        errorStorm: false,
      };
    }
    case "api_request_error": {
      const provider = text(extra.provider) ?? "unknown";
      const status = text(extra.status_code) ?? "none";
      const error = extra.error && typeof extra.error === "object" ? extra.error : {};
      const message =
        text((error as Record<string, unknown>).message, BODY_MAX) ?? text(extra.reason, BODY_MAX);
      return {
        item: {
          source: "hermes",
          kind: "failure",
          urgency: "whenever",
          title: `${provider} API error ${status}`,
          body: message ?? "",
          context: definedContext({
            provider,
            status,
            model: text(extra.model),
            profile: hermesProfile,
          }),
          dedupeKey: `hermes-api:${provider}:${status}`,
        },
        errorStorm: true,
      };
    }
    default:
      return undefined;
  }
}

// Raises a provider error to `today` once it has repeated ERROR_STORM_COUNT times within an hour.
async function raiseErrorStorm(ctx: MutationCtx, id: Id<"items">, now: number) {
  const item = await ctx.db.get(id);
  if (!item || item.urgency !== "whenever") return;
  const recent = await ctx.db
    .query("itemEvents")
    .withIndex("by_item_at", (q) => q.eq("itemId", id).gt("at", now - HOUR_MS))
    .filter((q) => q.or(q.eq(q.field("type"), "created"), q.eq(q.field("type"), "repeated")))
    .take(ERROR_STORM_COUNT);
  if (recent.length < ERROR_STORM_COUNT) return;
  await ctx.db.patch(id, { urgency: "today", updatedAt: now });
}

export const ingest = internalMutation({
  args: {
    deliveryId: v.string(),
    item: itemCreateValidator,
    errorStorm: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, { deliveryId, item, errorStorm, now }) => {
    const seen = await ctx.db
      .query("hermesHookDeliveries")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", deliveryId))
      .first();
    if (seen) return { duplicate: true };
    await ctx.db.insert("hermesHookDeliveries", { deliveryId, receivedAt: now });

    const result = await createItem(ctx, item, now);
    if (errorStorm && !result.created) await raiseErrorStorm(ctx, result.id, now);
    return { duplicate: false };
  },
});

// The committed generated api predates this module; Convex resolves it by name.
const pruneDeliveriesRef = makeFunctionReference<"mutation">("hermesHooks:pruneDeliveries");

// Deletes deliveries past retention, one batch per run, and runs again while a batch fills.
export const pruneDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("hermesHookDeliveries")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", Date.now() - DELIVERY_RETENTION_MS))
      .take(PRUNE_BATCH);
    for (const delivery of old) await ctx.db.delete(delivery._id);
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, pruneDeliveriesRef, {});
  },
});
