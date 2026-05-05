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
  shouldDropOpenClawReplyForThread,
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

type IdempotencyReceiptExpectation = {
  idempotencyKey: string;
  commandType: string;
  commandDigest: string;
  sessionKey?: string;
  threadId?: Id<"openclawThreads">;
  messageId?: Id<"openclawMessages">;
  actionId?: Id<"openclawActions">;
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

async function getMessageByIdempotencyKey(ctx: MutationCtx, idempotencyKey: string) {
  const messages = await ctx.db
    .query("openclawMessages")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
    .collect();

  if (messages.length > 1) {
    throw new Error(`Duplicate OpenClaw messages found for idempotency key ${idempotencyKey}`);
  }

  return messages.at(0);
}

async function getIdempotencyReceipt(ctx: MutationCtx, idempotencyKey: string) {
  const receipts = await ctx.db
    .query("openclawIdempotencyReceipts")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
    .collect();

  if (receipts.length > 1) {
    throw new Error(`Duplicate OpenClaw idempotency receipts found for key ${idempotencyKey}`);
  }

  return receipts.at(0);
}

async function getDuplicateIdempotencyReceipt(
  ctx: MutationCtx,
  expected: IdempotencyReceiptExpectation,
) {
  const receipt = await getIdempotencyReceipt(ctx, expected.idempotencyKey);
  if (!receipt) {
    return null;
  }

  assertIdempotencyReceiptMatches(receipt, expected);
  return receipt;
}

function assertIdempotencyReceiptMatches(
  receipt: Doc<"openclawIdempotencyReceipts">,
  expected: IdempotencyReceiptExpectation,
): void {
  if (
    receipt.commandType !== expected.commandType ||
    receipt.commandDigest !== expected.commandDigest ||
    receipt.sessionKey !== expected.sessionKey ||
    receipt.threadId !== expected.threadId ||
    receipt.messageId !== expected.messageId ||
    receipt.actionId !== expected.actionId
  ) {
    throw new Error(
      `Idempotency key ${expected.idempotencyKey} was already used for another command target`,
    );
  }
}

async function insertIdempotencyReceipt(
  ctx: MutationCtx,
  expected: IdempotencyReceiptExpectation,
  sequence: number,
) {
  const now = Date.now();
  await ctx.db.insert("openclawIdempotencyReceipts", {
    idempotencyKey: expected.idempotencyKey,
    commandType: expected.commandType,
    commandDigest: expected.commandDigest,
    sequence,
    createdAt: now,
    updatedAt: now,
    ...(expected.sessionKey !== undefined ? { sessionKey: expected.sessionKey } : {}),
    ...(expected.threadId !== undefined ? { threadId: expected.threadId } : {}),
    ...(expected.messageId !== undefined ? { messageId: expected.messageId } : {}),
    ...(expected.actionId !== undefined ? { actionId: expected.actionId } : {}),
  });
}

function commandDigest(value: unknown): string {
  return stableJson(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

async function actionIdsForMessage(ctx: MutationCtx, messageId: Id<"openclawMessages">) {
  const actions = await ctx.db
    .query("openclawActions")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .order("asc")
    .collect();

  return actions.map((action) => action._id);
}

async function acknowledgeDuplicateMessage(
  ctx: MutationCtx,
  message: Doc<"openclawMessages">,
  payload?: Record<string, unknown>,
) {
  const sequence = await insertOpenClawEvent(ctx, {
    type: "message_acknowledged",
    threadId: message.threadId,
    messageId: message._id,
    payload: buildAcknowledgementPayload(payload, {
      duplicate: true,
      reason: "duplicate_idempotency_key",
    }),
  });

  return {
    threadId: message.threadId,
    messageId: message._id,
    actionIds: await actionIdsForMessage(ctx, message._id),
    sequence,
  };
}

async function getDuplicateOpenClawMessageForSession(
  ctx: MutationCtx,
  idempotencyKey: string,
  sessionKey: string,
) {
  const message = await getMessageByIdempotencyKey(ctx, idempotencyKey);
  if (!message) {
    return null;
  }
  if (message.direction !== "openclaw_to_user") {
    throw new Error(
      `Idempotency key ${idempotencyKey} was already used for another command target`,
    );
  }

  const thread = await ctx.db.get(message.threadId);
  if (!thread || thread.sessionKey !== sessionKey) {
    throw new Error(
      `Idempotency key ${idempotencyKey} was already used for another command target`,
    );
  }

  return message;
}

async function getDuplicateIosReplyMessageForThread(
  ctx: MutationCtx,
  idempotencyKey: string,
  threadId: Id<"openclawThreads">,
) {
  const message = await getMessageByIdempotencyKey(ctx, idempotencyKey);
  if (!message) {
    return null;
  }
  if (message.direction !== "user_to_openclaw" || message.threadId !== threadId) {
    throw new Error(
      `Idempotency key ${idempotencyKey} was already used for another command target`,
    );
  }

  return message;
}

async function acknowledgeDuplicateReceipt(
  ctx: MutationCtx,
  receipt: Doc<"openclawIdempotencyReceipts">,
  payload?: Record<string, unknown>,
) {
  const sequence = await insertOpenClawEvent(ctx, {
    type: "message_acknowledged",
    ...(receipt.threadId !== undefined ? { threadId: receipt.threadId } : {}),
    ...(receipt.messageId !== undefined ? { messageId: receipt.messageId } : {}),
    ...(receipt.actionId !== undefined ? { actionId: receipt.actionId } : {}),
    payload: buildAcknowledgementPayload(payload, {
      duplicate: true,
      reason: "duplicate_idempotency_key",
    }),
  });

  return {
    ok: true,
    ...(receipt.threadId !== undefined ? { threadId: receipt.threadId } : {}),
    ...(receipt.messageId !== undefined ? { messageId: receipt.messageId } : {}),
    ...(receipt.actionId !== undefined ? { actionId: receipt.actionId } : {}),
    actionIds:
      receipt.messageId !== undefined ? await actionIdsForMessage(ctx, receipt.messageId) : [],
    sequence,
  };
}

function buildCommandEventPayload({
  payload,
  streamId,
}: {
  payload?: Record<string, unknown>;
  streamId?: string;
}): Record<string, unknown> | undefined {
  const eventPayload: Record<string, unknown> = { ...(payload ?? {}) };
  if (streamId !== undefined) {
    eventPayload.streamId = streamId;
  }
  return Object.keys(eventPayload).length === 0 ? undefined : eventPayload;
}

function buildAcknowledgementPayload(
  payload: Record<string, unknown> | undefined,
  options: { duplicate?: true; reason: string },
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    dropped: true,
    ...(options.duplicate === true ? { duplicate: true } : {}),
    reason: options.reason,
  };
}

export const createThreadFromOpenClaw = mutation({
  args: {
    serviceToken: v.string(),
    sessionKey: v.string(),
    idempotencyKey: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
    authorLabel: v.optional(v.string()),
    links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
    toolCalls: openclawToolCallsValidator,
    streamId: v.optional(v.string()),
    payload: v.optional(v.record(v.string(), v.any())),
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
    const eventPayload = buildCommandEventPayload(args);
    const existingThread = await getThreadBySessionKey(ctx, args.sessionKey);
    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "openclaw_message",
      commandDigest: commandDigest({
        sessionKey: args.sessionKey,
        title: args.title,
        text: args.text,
        authorLabel: args.authorLabel,
        links: args.links ?? [],
        toolCalls,
        actions: args.actions ?? [],
        deliveryState: args.deliveryState ?? "sent",
      }),
      sessionKey: args.sessionKey,
      ...(existingThread ? { threadId: existingThread._id } : {}),
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt, eventPayload);
    }

    const idempotentMessage = await getDuplicateOpenClawMessageForSession(
      ctx,
      args.idempotencyKey,
      args.sessionKey,
    );
    if (idempotentMessage) {
      return await acknowledgeDuplicateMessage(ctx, idempotentMessage, eventPayload);
    }

    if (existingThread && shouldDropOpenClawReplyForThread(existingThread)) {
      const sequence = await insertOpenClawEvent(ctx, {
        type: "message_acknowledged",
        threadId: existingThread._id,
        payload: buildAcknowledgementPayload(eventPayload, { reason: "thread_archived" }),
      });
      await insertIdempotencyReceipt(
        ctx,
        { ...receiptExpectation, threadId: existingThread._id },
        sequence,
      );

      return { threadId: existingThread._id, actionIds: [], sequence };
    }

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
      idempotencyKey: args.idempotencyKey,
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
      payload: eventPayload,
    });
    await insertIdempotencyReceipt(
      ctx,
      { ...receiptExpectation, threadId: thread, messageId },
      sequence,
    );

    return { threadId: thread, messageId, actionIds, sequence };
  },
});

export const updateMessageFromOpenClaw = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
    messageId: v.id("openclawMessages"),
    text: v.string(),
    links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
    toolCalls: openclawToolCallsValidator,
    streamId: v.optional(v.string()),
    payload: v.optional(v.record(v.string(), v.any())),
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
    const eventPayload = buildCommandEventPayload(args);

    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "openclaw_message_update",
      commandDigest: commandDigest({
        messageId: args.messageId,
        text: args.text,
        links: args.links,
        toolCalls: args.toolCalls ?? [],
        actions: args.actions ?? [],
        deliveryState: args.deliveryState,
      }),
      threadId: message.threadId,
      messageId: args.messageId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt, eventPayload);
    }

    if (shouldDropOpenClawReplyForThread(thread)) {
      const sequence = await insertOpenClawEvent(ctx, {
        type: "message_acknowledged",
        threadId: message.threadId,
        messageId: args.messageId,
        payload: buildAcknowledgementPayload(eventPayload, { reason: "thread_archived" }),
      });
      await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

      return { threadId: message.threadId, messageId: args.messageId, actionIds: [], sequence };
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
      payload: eventPayload,
    });
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

    return { threadId: message.threadId, messageId: args.messageId, actionIds, sequence };
  },
});

export const createPendingThreadFromIos = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();
    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "ios_new_thread",
      commandDigest: commandDigest({
        title: args.title,
        text: args.text,
      }),
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
    }

    const idempotentMessage = await getMessageByIdempotencyKey(ctx, args.idempotencyKey);
    if (idempotentMessage) {
      if (idempotentMessage.direction !== "user_to_openclaw") {
        throw new Error(
          `Idempotency key ${args.idempotencyKey} was already used for another command target`,
        );
      }
      return await acknowledgeDuplicateMessage(ctx, idempotentMessage);
    }

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
      toolCalls: [],
      deliveryState: "sent",
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_created",
      threadId,
      messageId,
    });
    await insertIdempotencyReceipt(ctx, { ...receiptExpectation, threadId, messageId }, sequence);

    return { threadId, messageId, sequence };
  },
});

export const bindThreadSession = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
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

    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "openclaw_session_bound",
      commandDigest: commandDigest({
        threadId: args.threadId,
        sessionKey: args.sessionKey,
      }),
      threadId: args.threadId,
      sessionKey: args.sessionKey,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
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
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

    return { ok: true, sequence };
  },
});

export const createReplyFromIos = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
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
    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "ios_reply",
      commandDigest: commandDigest({
        threadId: args.threadId,
        text: args.text,
      }),
      threadId: args.threadId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
    }

    const idempotentMessage = await getDuplicateIosReplyMessageForThread(
      ctx,
      args.idempotencyKey,
      args.threadId,
    );
    if (idempotentMessage) {
      return await acknowledgeDuplicateMessage(ctx, idempotentMessage);
    }

    const messageId = await ctx.db.insert("openclawMessages", {
      threadId: args.threadId,
      direction: "user_to_openclaw",
      text: args.text,
      links: [],
      toolCalls: [],
      deliveryState: "sent",
      idempotencyKey: args.idempotencyKey,
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
    await insertIdempotencyReceipt(ctx, { ...receiptExpectation, messageId }, sequence);

    return { messageId, sequence };
  },
});

export const submitActionFromIos = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
    actionId: v.id("openclawActions"),
    payload: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const action = await ctx.db.get(args.actionId);
    if (!action) {
      throw new Error(`Action not found: ${args.actionId}`);
    }

    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "ios_action",
      commandDigest: commandDigest({
        payload: args.payload,
      }),
      threadId: action.threadId,
      actionId: args.actionId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
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
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

    return { ok: true, sequence };
  },
});

export const recordActionResultFromOpenClaw = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
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

    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "openclaw_action_result",
      commandDigest: commandDigest({
        actionId: args.actionId,
        state: args.state,
        resultMetadata: args.resultMetadata,
      }),
      threadId: action.threadId,
      actionId: args.actionId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
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
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

    return { ok: true, sequence };
  },
});

export const markThreadRead = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
    threadId: v.id("openclawThreads"),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "ios_mark_thread_read",
      commandDigest: commandDigest({
        threadId: args.threadId,
      }),
      threadId: args.threadId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
    }

    await ctx.db.patch(args.threadId, {
      unreadCount: 0,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_updated",
      threadId: args.threadId,
    });
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

    return { ok: true, sequence };
  },
});

export const renameThreadFromIos = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
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

    const nextTitle = normalizeOpenClawTitle(args.title);
    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "ios_rename_thread",
      commandDigest: commandDigest({
        threadId: args.threadId,
        title: nextTitle,
      }),
      threadId: args.threadId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
    }

    await ctx.db.patch(args.threadId, {
      title: nextTitle,
      updatedAt: now,
    });

    const sequence = await insertOpenClawEvent(ctx, {
      type: "thread_updated",
      threadId: args.threadId,
    });
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

    return { ok: true, sequence };
  },
});

export const deleteThreadFromIos = mutation({
  args: {
    serviceToken: v.string(),
    idempotencyKey: v.string(),
    threadId: v.id("openclawThreads"),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const now = Date.now();

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }

    const receiptExpectation = {
      idempotencyKey: args.idempotencyKey,
      commandType: "ios_delete_thread",
      commandDigest: commandDigest({
        threadId: args.threadId,
      }),
      threadId: args.threadId,
    };
    const duplicateReceipt = await getDuplicateIdempotencyReceipt(ctx, receiptExpectation);
    if (duplicateReceipt) {
      return await acknowledgeDuplicateReceipt(ctx, duplicateReceipt);
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
    await insertIdempotencyReceipt(ctx, receiptExpectation, sequence);

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
