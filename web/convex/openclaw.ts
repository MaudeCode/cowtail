import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import { requireRealtimeConvexToken } from "./authSessions";
import {
  applyOpenClawThreadTitlePatch,
  buildOpenClawActionResultUpdate,
  buildOpenClawMessageUpdatePatch,
  normalizeOpenClawTitle,
  toOpenClawEventEnvelope,
  toOpenClawMessageWithActionsRecord,
  toOpenClawThreadRecord,
  validateOpenClawAfterSequence,
  validateOpenClawToolCalls,
  validateOpenClawLimit,
  type OpenClawEventPayloadInput,
} from "./openclawModel";
import { openclawToolCallsValidator } from "./openclawValidators";

type OpenClawEventInsertArgs = {
  type: OpenClawEventPayloadInput["type"];
  threadId?: Id<"openclawThreads">;
  messageId?: Id<"openclawMessages">;
  actionId?: Id<"openclawActions">;
  payload?: Record<string, unknown>;
};

const OPENCLAW_EVENTS_STATE_KEY = "openclaw-events";

async function getUniqueOpenClawStateRow(ctx: MutationCtx) {
  const rows = await ctx.db
    .query("openclawState")
    .withIndex("by_key", (q) => q.eq("key", OPENCLAW_EVENTS_STATE_KEY))
    .collect();

  if (rows.length > 1) {
    throw new Error(`Duplicate openclaw state rows found for key ${OPENCLAW_EVENTS_STATE_KEY}`);
  }

  return rows.at(0);
}

async function allocateOpenClawEventSequence(ctx: MutationCtx): Promise<number> {
  const now = Date.now();
  const existingState = await getUniqueOpenClawStateRow(ctx);

  if (existingState) {
    const sequence = existingState.nextSequence;
    await ctx.db.patch(existingState._id, {
      nextSequence: existingState.nextSequence + 1,
      updatedAt: now,
    });
    return sequence;
  }

  await ctx.db.insert("openclawState", {
    key: OPENCLAW_EVENTS_STATE_KEY,
    nextSequence: 2,
    updatedAt: now,
  });

  return 1;
}

async function insertOpenClawEvent(
  ctx: MutationCtx,
  args: OpenClawEventInsertArgs,
): Promise<number> {
  const sequence = await allocateOpenClawEventSequence(ctx);
  const now = Date.now();

  await ctx.db.insert("openclawEvents", {
    type: args.type,
    sequence,
    createdAt: now,
    ...(args.threadId ? { threadId: args.threadId } : {}),
    ...(args.messageId ? { messageId: args.messageId } : {}),
    ...(args.actionId ? { actionId: args.actionId } : {}),
    ...(args.payload ? { payload: args.payload } : {}),
  });

  return sequence;
}

async function hydrateOpenClawEvent(ctx: QueryCtx | MutationCtx, event: Doc<"openclawEvents">) {
  const thread = event.threadId !== undefined ? await ctx.db.get(event.threadId) : null;
  const message = event.messageId !== undefined ? await ctx.db.get(event.messageId) : null;
  const action = event.actionId !== undefined ? await ctx.db.get(event.actionId) : null;
  const messageId = event.messageId;
  const actions =
    messageId !== undefined
      ? await ctx.db
          .query("openclawActions")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .order("asc")
          .collect()
      : null;

  return toOpenClawEventEnvelope({ event, thread, message, action, actions });
}

async function listVisibleOpenClawThreads(ctx: QueryCtx, limit: number) {
  const [activeThreads, pendingThreads] = await Promise.all([
    ctx.db
      .query("openclawThreads")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "active"))
      .order("desc")
      .take(limit),
    ctx.db
      .query("openclawThreads")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(limit),
  ]);

  return [...activeThreads, ...pendingThreads]
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      return String(left._id).localeCompare(String(right._id));
    })
    .slice(0, limit);
}

async function getThreadBySessionKey(ctx: MutationCtx, sessionKey: string) {
  const threads = await ctx.db
    .query("openclawThreads")
    .withIndex("by_sessionKey", (q) => q.eq("sessionKey", sessionKey))
    .collect();

  if (threads.length > 1) {
    throw new Error(`Duplicate threads found for sessionKey ${sessionKey}`);
  }

  return threads.at(0);
}

export const createThreadFromOpenClaw = mutation({
  args: {
    serviceToken: v.string(),
    sessionKey: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
    authorLabel: v.optional(v.string()),
    links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
    toolCalls: openclawToolCallsValidator,
    deliveryState: v.optional(
      v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    ),
    actions: v.optional(
      v.array(
        v.object({
          label: v.string(),
          kind: v.string(),
          payload: v.record(v.string(), v.any()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();
    const toolCalls = validateOpenClawToolCalls(args.toolCalls ?? []);
    const existingThread = await getThreadBySessionKey(ctx, args.sessionKey);

    const thread = existingThread
      ? await (async () => {
          const threadPatch: {
            status: "active";
            unreadCount: number;
            updatedAt: number;
            lastMessageAt: number;
            title?: string;
          } = {
            status: "active",
            unreadCount: existingThread.unreadCount + 1,
            updatedAt: now,
            lastMessageAt: now,
          };

          const nextTitle = applyOpenClawThreadTitlePatch(existingThread.title, args.title);
          if (nextTitle !== existingThread.title) {
            threadPatch.title = nextTitle;
          }

          await ctx.db.patch(existingThread._id, threadPatch);

          return existingThread._id;
        })()
      : await ctx.db.insert("openclawThreads", {
          sessionKey: args.sessionKey,
          title: normalizeOpenClawTitle(args.title),
          targetAgent: "default",
          status: "active",
          unreadCount: 1,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
        });

    const messageId = await ctx.db.insert("openclawMessages", {
      threadId: thread,
      direction: "openclaw_to_user",
      text: args.text,
      links: args.links ?? [],
      toolCalls,
      deliveryState: args.deliveryState ?? "sent",
      createdAt: now,
      updatedAt: now,
      ...(args.authorLabel ? { authorLabel: args.authorLabel } : {}),
    });

    const actionIds: Array<Id<"openclawActions">> = [];
    if (args.actions) {
      for (const action of args.actions) {
        const actionId = await ctx.db.insert("openclawActions", {
          threadId: thread,
          messageId,
          label: action.label,
          kind: action.kind,
          payload: action.payload,
          state: "pending",
          createdAt: now,
          updatedAt: now,
        });
        actionIds.push(actionId);
      }
    }

    const sequence = await insertOpenClawEvent(ctx, {
      type: "message_created",
      threadId: thread,
      messageId,
    });

    return { threadId: thread, messageId, actionIds, sequence };
  },
});

export const updateMessageFromOpenClaw = mutation({
  args: {
    serviceToken: v.string(),
    messageId: v.id("openclawMessages"),
    text: v.string(),
    links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
    toolCalls: openclawToolCallsValidator,
    deliveryState: v.optional(
      v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    ),
    actions: v.optional(
      v.array(
        v.object({
          label: v.string(),
          kind: v.string(),
          payload: v.record(v.string(), v.any()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error(`Message not found: ${args.messageId}`);
    }
    if (message.direction !== "openclaw_to_user") {
      throw new Error(`Message is not an OpenClaw reply: ${args.messageId}`);
    }

    const thread = await ctx.db.get(message.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${message.threadId}`);
    }

    const now = Date.now();
    await ctx.db.patch(
      args.messageId,
      buildOpenClawMessageUpdatePatch({
        text: args.text,
        links: args.links,
        toolCalls: args.toolCalls,
        deliveryState: args.deliveryState,
        updatedAt: now,
      }),
    );

    await ctx.db.patch(message.threadId, {
      updatedAt: now,
      lastMessageAt: now,
    });

    const actionIds: Array<Id<"openclawActions">> = [];
    if (args.actions && args.actions.length > 0) {
      const existingActions = await ctx.db
        .query("openclawActions")
        .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
        .collect();

      if (existingActions.length === 0) {
        for (const action of args.actions) {
          const actionId = await ctx.db.insert("openclawActions", {
            threadId: message.threadId,
            messageId: args.messageId,
            label: action.label,
            kind: action.kind,
            payload: action.payload,
            state: "pending",
            createdAt: now,
            updatedAt: now,
          });
          actionIds.push(actionId);
        }
      }
    }

    const sequence = await insertOpenClawEvent(ctx, {
      type: "message_updated",
      threadId: message.threadId,
      messageId: args.messageId,
    });

    return { threadId: message.threadId, messageId: args.messageId, actionIds, sequence };
  },
});

export const createPendingThreadFromIos = mutation({
  args: {
    serviceToken: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const threadId = await ctx.db.insert("openclawThreads", {
      title: normalizeOpenClawTitle(args.title),
      targetAgent: "default",
      status: "pending",
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    });

    const messageId = await ctx.db.insert("openclawMessages", {
      threadId,
      direction: "user_to_openclaw",
      text: args.text,
      links: [],
      deliveryState: "sent",
      createdAt: now,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_created",
      threadId,
      messageId,
    });

    return { threadId, messageId, sequence };
  },
});

export const bindThreadSession = mutation({
  args: {
    serviceToken: v.string(),
    threadId: v.id("openclawThreads"),
    sessionKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    const currentSessionOwner = await getThreadBySessionKey(ctx, args.sessionKey);
    if (currentSessionOwner && currentSessionOwner._id !== args.threadId) {
      throw new Error(
        `Session key ${args.sessionKey} is already owned by thread ${currentSessionOwner._id}`,
      );
    }

    await ctx.db.patch(args.threadId, {
      sessionKey: args.sessionKey,
      status: "active",
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "session_bound",
      threadId: args.threadId,
      payload: { sessionKey: args.sessionKey },
    });

    return { ok: true, sequence };
  },
});

export const createReplyFromIos = mutation({
  args: {
    serviceToken: v.string(),
    threadId: v.id("openclawThreads"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    const now = Date.now();

    const messageId = await ctx.db.insert("openclawMessages", {
      threadId: args.threadId,
      direction: "user_to_openclaw",
      text: args.text,
      links: [],
      deliveryState: "sent",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.threadId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "reply_created",
      threadId: args.threadId,
      messageId,
    });

    return { messageId, sequence };
  },
});

export const submitActionFromIos = mutation({
  args: {
    serviceToken: v.string(),
    actionId: v.id("openclawActions"),
    payload: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error(`Action not found: ${args.actionId}`);
    }

    const now = Date.now();

    await ctx.db.patch(args.actionId, {
      payload: args.payload,
      state: "submitted",
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "action_submitted",
      threadId: action.threadId,
      actionId: args.actionId,
      payload: args.payload,
    });

    return { ok: true, sequence };
  },
});

export const recordActionResultFromOpenClaw = mutation({
  args: {
    serviceToken: v.string(),
    actionId: v.id("openclawActions"),
    state: v.union(v.literal("submitted"), v.literal("failed"), v.literal("expired")),
    resultMetadata: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error(`Action not found: ${args.actionId}`);
    }

    const now = Date.now();
    const { actionPatch, eventPayload } = buildOpenClawActionResultUpdate({
      state: args.state,
      resultMetadata: args.resultMetadata,
      updatedAt: now,
    });

    await ctx.db.patch(args.actionId, actionPatch);

    const sequence = await insertOpenClawEvent(ctx, {
      type: "action_result",
      threadId: action.threadId,
      actionId: args.actionId,
      payload: eventPayload,
    });

    return { ok: true, sequence };
  },
});

export const markThreadRead = mutation({
  args: {
    serviceToken: v.string(),
    threadId: v.id("openclawThreads"),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    await ctx.db.patch(args.threadId, {
      unreadCount: 0,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_updated",
      threadId: args.threadId,
    });

    return { ok: true, sequence };
  },
});

export const renameThreadFromIos = mutation({
  args: {
    serviceToken: v.string(),
    threadId: v.id("openclawThreads"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    await ctx.db.patch(args.threadId, {
      title: normalizeOpenClawTitle(args.title),
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_updated",
      threadId: args.threadId,
    });

    return { ok: true, sequence };
  },
});

export const deleteThreadFromIos = mutation({
  args: {
    serviceToken: v.string(),
    threadId: v.id("openclawThreads"),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    await ctx.db.patch(args.threadId, {
      status: "archived",
      unreadCount: 0,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_updated",
      threadId: args.threadId,
      payload: { deleted: true },
    });

    return { ok: true, sequence };
  },
});

export const listThreads = query({
  args: {
    serviceToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const limit = validateOpenClawLimit(args.limit);

    return await listVisibleOpenClawThreads(ctx, limit);
  },
});

export const listMessages = query({
  args: {
    serviceToken: v.string(),
    threadId: v.id("openclawThreads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const limit = validateOpenClawLimit(args.limit);

    return await ctx.db
      .query("openclawMessages")
      .withIndex("by_thread_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .take(limit);
  },
});

export const listActionsForMessage = query({
  args: {
    serviceToken: v.string(),
    messageId: v.id("openclawMessages"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const limit = validateOpenClawLimit(args.limit);

    return await ctx.db
      .query("openclawActions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .order("asc")
      .take(limit);
  },
});

export const listThreadsForApp = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = validateOpenClawLimit(args.limit);
    const threads = await listVisibleOpenClawThreads(ctx, limit);

    return threads.map(toOpenClawThreadRecord);
  },
});

export const listMessagesForApp = internalQuery({
  args: {
    threadId: v.id("openclawThreads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = validateOpenClawLimit(args.limit);
    const messages = await ctx.db
      .query("openclawMessages")
      .withIndex("by_thread_createdAt", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .take(limit);

    const records = [];
    for (const message of messages) {
      const actions = await ctx.db
        .query("openclawActions")
        .withIndex("by_message", (q) => q.eq("messageId", message._id))
        .order("asc")
        .collect();
      records.push(toOpenClawMessageWithActionsRecord(message, actions));
    }

    return records;
  },
});

export const replayEvents = query({
  args: {
    serviceToken: v.string(),
    afterSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const limit = validateOpenClawLimit(args.limit);
    const afterSequence = validateOpenClawAfterSequence(args.afterSequence);

    const events =
      afterSequence === undefined
        ? await ctx.db.query("openclawEvents").withIndex("by_sequence").order("asc").take(limit)
        : await ctx.db
            .query("openclawEvents")
            .withIndex("by_sequence", (q) => q.gt("sequence", afterSequence))
            .order("asc")
            .take(limit);

    const envelopes: OpenClawEventEnvelope[] = [];
    for (const event of events) {
      envelopes.push(await hydrateOpenClawEvent(ctx, event));
    }

    return envelopes;
  },
});
