import { createChannelReplyPipeline } from "openclaw/plugin-sdk/channel-reply-pipeline";
import { normalizeOutboundReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import type {
  OpenClawActionRecord,
  OpenClawEventEnvelope,
  OpenClawMessageRecord,
  OpenClawThreadRecord,
  OpenClawToolCallRecord,
} from "@maudecode/cowtail-protocol";

import type { CowtailRealtimeClient } from "./client.js";
import type { ResolvedCowtailAccount } from "./types.js";
import { buildCowtailTarget, isSupportedCowtailAgent } from "./session-keys.js";

type Logger = {
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type CowtailInboundRuntime = {
  config: Pick<PluginRuntime["config"], "loadConfig">;
  agent: {
    session: Pick<PluginRuntime["agent"]["session"], "resolveStorePath">;
  };
  channel: {
    routing: {
      resolveAgentRoute: (params: {
        cfg: ReturnType<PluginRuntime["config"]["loadConfig"]>;
        channel: string;
        accountId: string;
        peer: {
          kind: string;
          id: string;
        };
      }) => {
        agentId: string;
        sessionKey: string;
      };
    };
    session: Pick<
      PluginRuntime["channel"]["session"],
      "readSessionUpdatedAt" | "recordInboundSession"
    >;
    reply: {
      resolveEnvelopeFormatOptions: PluginRuntime["channel"]["reply"]["resolveEnvelopeFormatOptions"];
      formatAgentEnvelope: (params: {
        channel: string;
        from: string;
        timestamp?: number;
        previousTimestamp?: number;
        envelope: ReturnType<PluginRuntime["channel"]["reply"]["resolveEnvelopeFormatOptions"]>;
        body: string;
      }) => string;
      finalizeInboundContext: <T extends Record<string, unknown>>(
        ctx: T & { CommandAuthorized: boolean },
        opts?: {
          forceBodyForAgent?: boolean;
          forceBodyForCommands?: boolean;
          forceChatType?: boolean;
          forceConversationLabel?: boolean;
        },
      ) => T & { CommandAuthorized: boolean };
      dispatchReplyWithBufferedBlockDispatcher: (params: {
        ctx: Record<string, unknown>;
        cfg: ReturnType<PluginRuntime["config"]["loadConfig"]>;
        dispatcherOptions: {
          deliver?: (payload: unknown, info?: CowtailReplyDispatchInfo) => Promise<void>;
        } & Record<string, unknown>;
        replyOptions?: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
};
type CowtailInboundClient = Pick<
  CowtailRealtimeClient,
  "sendSessionBound" | "sendActionResult" | "sendOpenClawMessage" | "sendOpenClawMessageUpdate"
>;
type CowtailRoute = {
  agentId: string;
  sessionKey: string;
};
type CowtailReplyPayload = {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string;
};
type CowtailReplyDispatchInfo = {
  kind?: "tool" | "block" | "final";
};
type CowtailReplyStreamState = {
  idempotencyKey: string;
  messageId?: string;
  failed?: boolean;
  completed?: boolean;
  text: string;
  links: Array<{ label: string; url: string }>;
  toolCalls: OpenClawToolCallRecord[];
};

const CHANNEL_ID = "cowtail";
const CHANNEL_LABEL = "Cowtail";
const SENDER_LABEL = "Cowtail iOS";
const SENDER_ID = "cowtail-ios";
const SENDER_ADDRESS = "cowtail:ios";

export async function handleCowtailEvent(params: {
  event: OpenClawEventEnvelope;
  account: ResolvedCowtailAccount;
  client: CowtailInboundClient;
  runtime: CowtailInboundRuntime;
  logger?: Logger;
}): Promise<void> {
  const { event, account, client, runtime, logger } = params;

  switch (event.type) {
    case "thread_created": {
      const thread = event.thread;
      const message = event.message;
      if (!thread || !message) {
        logger?.warn?.("Cowtail thread_created event missing thread or message payload");
        return;
      }
      if (!thread.sessionKey && thread.status !== "pending") {
        logger?.warn?.("Cowtail thread_created event missing pending thread binding state");
        return;
      }

      const route = resolveThreadRoute({
        thread,
        account,
        runtime,
        ...(logger ? { logger } : {}),
      });
      if (!route) {
        return;
      }

      if (!thread.sessionKey) {
        await client.sendSessionBound({
          type: "openclaw_session_bound",
          idempotencyKey: `cowtail:session-bound:${thread.id}`,
          threadId: thread.id,
          sessionKey: route.sessionKey,
        });
      }

      await dispatchCowtailTextTurn({
        account,
        client,
        runtime,
        route,
        thread,
        message,
        ...(logger ? { logger } : {}),
      });
      return;
    }

    case "reply_created": {
      const thread = event.thread;
      const message = event.message;
      if (!thread || !message) {
        logger?.warn?.("Cowtail reply_created event missing thread or message payload");
        return;
      }
      if (!thread.sessionKey) {
        logger?.warn?.("Cowtail reply_created event is missing a bound session key");
        return;
      }

      await dispatchCowtailTextTurn({
        account,
        client,
        runtime,
        route: {
          agentId: account.agentId,
          sessionKey: thread.sessionKey,
        },
        thread,
        message,
        ...(logger ? { logger } : {}),
      });
      return;
    }

    case "action_submitted": {
      const thread = event.thread;
      const action = event.action;
      if (!thread || !action) {
        logger?.warn?.("Cowtail action_submitted event missing thread or action payload");
        return;
      }
      if (!thread.sessionKey) {
        logger?.warn?.("Cowtail action_submitted event is missing a bound session key");
        return;
      }

      try {
        const dispatchSucceeded = await dispatchCowtailActionTurn({
          account,
          client,
          runtime,
          route: {
            agentId: account.agentId,
            sessionKey: thread.sessionKey,
          },
          thread,
          action,
          payload: event.payload ?? action.payload,
          timestamp: event.createdAt,
          ...(logger ? { logger } : {}),
        });
        await client.sendActionResult({
          type: "openclaw_action_result",
          idempotencyKey: `cowtail:action-result:${action.id}:${dispatchSucceeded ? "submitted" : "failed"}`,
          actionId: action.id,
          state: dispatchSucceeded ? "submitted" : "failed",
        });
      } catch (error) {
        logger?.error?.(`Cowtail action dispatch failed: ${errorMessage(error)}`);
        await client.sendActionResult({
          type: "openclaw_action_result",
          idempotencyKey: `cowtail:action-result:${action.id}:failed`,
          actionId: action.id,
          state: "failed",
        });
      }
      return;
    }

    default:
      return;
  }
}

export async function dispatchCowtailTextTurn(params: {
  account: ResolvedCowtailAccount;
  client: CowtailInboundClient;
  runtime: CowtailInboundRuntime;
  logger?: Logger;
  route: CowtailRoute;
  thread: OpenClawThreadRecord;
  message: OpenClawMessageRecord;
}): Promise<void> {
  const { account, client, runtime, logger, route, thread, message } = params;
  const text = message.text;
  const { body, storePath } = buildCowtailInboundBody({
    runtime,
    route,
    text,
    timestamp: message.createdAt,
  });
  const ctxPayload = finalizeInboundContext({
    runtime,
    account,
    route,
    thread,
    itemId: message.id,
    text,
    body,
    timestamp: message.createdAt,
  });
  const streamState: CowtailReplyStreamState = {
    idempotencyKey: `cowtail:reply:${message.id}`,
    text: "",
    links: [],
    toolCalls: [],
  };

  await recordCowtailInboundSessionAndDispatchReply({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
    agentId: route.agentId,
    route,
    storePath,
    ctxPayload,
    runtime,
    deliver: async (payload, info, rawPayload) =>
      deliverCowtailReply({
        client,
        route,
        thread,
        payload,
        rawPayload,
        info,
        streamState,
      }),
    onRecordError: (error) => {
      logger?.error?.(`Cowtail inbound session record failed: ${errorMessage(error)}`);
    },
    onDispatchError: (error, info) => {
      logger?.error?.(`Cowtail ${info.kind} reply failed: ${errorMessage(error)}`);
    },
  });

  await finalizeCowtailStreamedReply({
    client,
    streamState,
  });
}

export async function dispatchCowtailActionTurn(params: {
  account: ResolvedCowtailAccount;
  client: CowtailInboundClient;
  runtime: CowtailInboundRuntime;
  logger?: Logger;
  route: CowtailRoute;
  thread: OpenClawThreadRecord;
  action: OpenClawActionRecord;
  payload: Record<string, unknown>;
  timestamp: number;
}): Promise<boolean> {
  const { account, client, runtime, logger, route, thread, action, payload, timestamp } = params;
  const text = [
    `Cowtail action selected: ${action.label}`,
    `kind: ${action.kind}`,
    `payload: ${JSON.stringify(payload)}`,
  ].join("\n");
  const { body, storePath } = buildCowtailInboundBody({
    runtime,
    route,
    text,
    timestamp,
  });
  const ctxPayload = finalizeInboundContext({
    runtime,
    account,
    route,
    thread,
    itemId: action.id,
    text,
    body,
    timestamp,
  });
  let dispatchFailed = false;
  const streamState: CowtailReplyStreamState = {
    idempotencyKey: `cowtail:action:${action.id}`,
    text: "",
    links: [],
    toolCalls: [],
  };

  await recordCowtailInboundSessionAndDispatchReply({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
    agentId: route.agentId,
    route,
    storePath,
    ctxPayload,
    runtime,
    deliver: async (replyPayload, info, rawPayload) =>
      deliverCowtailReply({
        client,
        route,
        thread,
        payload: replyPayload,
        rawPayload,
        info,
        streamState,
      }),
    onRecordError: (error) => {
      logger?.error?.(`Cowtail inbound session record failed: ${errorMessage(error)}`);
    },
    onDispatchError: (error, info) => {
      dispatchFailed = true;
      logger?.error?.(`Cowtail ${info.kind} reply failed: ${errorMessage(error)}`);
    },
  });

  await finalizeCowtailStreamedReply({
    client,
    streamState,
  });

  return !dispatchFailed;
}

async function recordCowtailInboundSessionAndDispatchReply(params: {
  cfg: ReturnType<PluginRuntime["config"]["loadConfig"]>;
  channel: string;
  accountId: string;
  agentId: string;
  route: CowtailRoute;
  storePath: string;
  ctxPayload: Record<string, unknown>;
  runtime: CowtailInboundRuntime;
  deliver: (
    payload: CowtailReplyPayload,
    info?: CowtailReplyDispatchInfo,
    rawPayload?: unknown,
  ) => Promise<void>;
  onRecordError: (error: unknown) => void;
  onDispatchError: (error: unknown, info: { kind: string }) => void;
}): Promise<void> {
  await params.runtime.channel.session.recordInboundSession({
    storePath: params.storePath,
    sessionKey:
      typeof params.ctxPayload.SessionKey === "string"
        ? params.ctxPayload.SessionKey
        : params.route.sessionKey,
    ctx: params.ctxPayload,
    onRecordError: params.onRecordError,
  });

  const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: params.channel,
    accountId: params.accountId,
  });

  await params.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: params.ctxPayload,
    cfg: params.cfg,
    dispatcherOptions: {
      ...replyPipeline,
      deliver: async (payload: unknown, info?: CowtailReplyDispatchInfo) => {
        try {
          await params.deliver(normalizeCowtailReplyPayload(payload), info, payload);
        } catch (error) {
          params.onDispatchError(error, { kind: info?.kind ?? "final" });
        }
      },
      onError: params.onDispatchError,
    },
    replyOptions: {
      disableBlockStreaming: false,
      onModelSelected,
    },
  });
}

async function deliverCowtailReply(params: {
  client: CowtailInboundClient;
  route: CowtailRoute;
  thread: OpenClawThreadRecord;
  payload: CowtailReplyPayload;
  rawPayload?: unknown;
  info: CowtailReplyDispatchInfo | undefined;
  streamState: CowtailReplyStreamState;
}): Promise<void> {
  if (params.streamState.failed) {
    return;
  }

  const text = params.payload.text;
  const kind = params.info?.kind ?? "final";
  const links = resolveCowtailReplyLinks(params.payload);
  if (links.length > 0) {
    params.streamState.links = links;
  }

  if (kind === "tool") {
    const toolCall = buildCowtailToolCall({
      payload: params.payload,
      rawPayload: params.rawPayload,
      streamState: params.streamState,
    });
    params.streamState.toolCalls = [...params.streamState.toolCalls, toolCall];
    const messageText = params.streamState.text;

    if (!params.streamState.messageId) {
      const result = await params.client.sendOpenClawMessage({
        type: "openclaw_message",
        idempotencyKey: params.streamState.idempotencyKey,
        sessionKey: params.thread.sessionKey ?? params.route.sessionKey,
        title: params.thread.title,
        text: messageText,
        authorLabel: "OpenClaw",
        links,
        toolCalls: params.streamState.toolCalls,
        actions: [],
        deliveryState: "pending",
      });
      const messageId = recordCreatedOpenClawMessageId(params.streamState, result);
      if (!messageId) {
        return;
      }
      params.streamState.messageId = messageId;
      return;
    }

    await params.client.sendOpenClawMessageUpdate({
      type: "openclaw_message_update",
      messageId: params.streamState.messageId,
      text: messageText,
      links,
      toolCalls: params.streamState.toolCalls,
      deliveryState: "pending",
    });
    return;
  }

  if (typeof text !== "string" || !text.trim()) {
    return;
  }

  if (kind === "block") {
    params.streamState.text = appendReplyBlock(params.streamState.text, text);
    if (!params.streamState.messageId) {
      const result = await params.client.sendOpenClawMessage({
        type: "openclaw_message",
        idempotencyKey: params.streamState.idempotencyKey,
        sessionKey: params.thread.sessionKey ?? params.route.sessionKey,
        title: params.thread.title,
        text: params.streamState.text,
        authorLabel: "OpenClaw",
        links,
        toolCalls: params.streamState.toolCalls,
        actions: [],
        deliveryState: "pending",
      });
      const messageId = recordCreatedOpenClawMessageId(params.streamState, result);
      if (!messageId) {
        return;
      }
      params.streamState.messageId = messageId;
      return;
    }

    await params.client.sendOpenClawMessageUpdate({
      type: "openclaw_message_update",
      messageId: params.streamState.messageId,
      text: params.streamState.text,
      links,
      toolCalls: params.streamState.toolCalls,
      deliveryState: "pending",
    });
    return;
  }

  if (params.streamState.messageId) {
    params.streamState.text = text;
    await params.client.sendOpenClawMessageUpdate({
      type: "openclaw_message_update",
      messageId: params.streamState.messageId,
      text,
      links,
      toolCalls: params.streamState.toolCalls,
      actions: [],
      deliveryState: "sent",
    });
    params.streamState.completed = true;
    return;
  }

  await params.client.sendOpenClawMessage({
    type: "openclaw_message",
    idempotencyKey: params.streamState.idempotencyKey,
    sessionKey: params.thread.sessionKey ?? params.route.sessionKey,
    title: params.thread.title,
    text,
    authorLabel: "OpenClaw",
    links,
    toolCalls: params.streamState.toolCalls,
    actions: [],
    deliveryState: "sent",
  });
  params.streamState.completed = true;
}

async function finalizeCowtailStreamedReply(params: {
  client: CowtailInboundClient;
  streamState: CowtailReplyStreamState;
}): Promise<void> {
  if (
    params.streamState.failed ||
    params.streamState.completed ||
    !params.streamState.messageId ||
    (!params.streamState.text.trim() && params.streamState.toolCalls.length === 0)
  ) {
    return;
  }

  await params.client.sendOpenClawMessageUpdate({
    type: "openclaw_message_update",
    messageId: params.streamState.messageId,
    text: params.streamState.text,
    links: params.streamState.links,
    toolCalls: params.streamState.toolCalls,
    actions: [],
    deliveryState: "sent",
  });
  params.streamState.completed = true;
}

function recordCreatedOpenClawMessageId(
  streamState: CowtailReplyStreamState,
  result: { payload?: Record<string, unknown> },
): string | undefined {
  if (result.payload?.dropped === true) {
    streamState.failed = true;
    streamState.completed = true;
    return undefined;
  }

  const messageId = result.payload?.messageId;
  if (typeof messageId === "string" && messageId.trim()) {
    return messageId;
  }

  streamState.failed = true;
  throw new Error("Cowtail realtime ack missing messageId for streamed OpenClaw reply");
}

function resolveCowtailReplyLinks(payload: CowtailReplyPayload) {
  const urls = [
    ...(Array.isArray(payload.mediaUrls) ? payload.mediaUrls : []),
    ...(typeof payload.mediaUrl === "string" ? [payload.mediaUrl] : []),
  ].filter((url) => url.trim().length > 0);

  return urls.map((url, index) => ({
    label: urls.length === 1 ? "Attachment" : `Attachment ${index + 1}`,
    url,
  }));
}

function normalizeCowtailReplyPayload(payload: unknown): CowtailReplyPayload {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return normalizeOutboundReplyPayload(payload as Record<string, unknown>);
}

function buildCowtailToolCall(params: {
  payload: CowtailReplyPayload;
  rawPayload: unknown;
  streamState: CowtailReplyStreamState;
}): OpenClawToolCallRecord {
  const rawToolCall = readRawToolCall(params.rawPayload);
  const index = params.streamState.toolCalls.length + 1;

  return {
    id: rawToolCall.id ?? `tool-${index}`,
    name: rawToolCall.name ?? "tool_result",
    ...(rawToolCall.args ? { args: rawToolCall.args } : {}),
    result:
      rawToolCall.result !== undefined
        ? rawToolCall.result
        : (params.payload.text ?? params.payload),
    status: rawToolCall.status ?? "complete",
    ...(rawToolCall.startedAt !== undefined ? { startedAt: rawToolCall.startedAt } : {}),
    completedAt: rawToolCall.completedAt ?? Date.now(),
    insertedAtContentLength: params.streamState.text.length,
    contentSnapshotAtStart: params.streamState.text,
  };
}

function readRawToolCall(payload: unknown): Partial<OpenClawToolCallRecord> {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const candidate = payload as Record<string, unknown>;
  const channelData = candidate.channelData;
  const toolCall =
    channelData && typeof channelData === "object"
      ? (channelData as Record<string, unknown>).toolCall
      : undefined;
  const source =
    toolCall && typeof toolCall === "object" ? (toolCall as Record<string, unknown>) : candidate;

  const name = readString(source.name) ?? readString(source.toolName) ?? readString(source.tool);
  const id = readString(source.id) ?? readString(source.toolCallId);
  const status = readToolCallStatus(source.status);
  const args = readRecord(source.args) ?? readRecord(source.input);
  const startedAt = readTimestamp(source.startedAt);
  const completedAt = readTimestamp(source.completedAt);
  const insertedAtContentLength = readNonnegativeInteger(source.insertedAtContentLength);
  const contentSnapshotAtStart = readString(source.contentSnapshotAtStart);
  const result = source.result ?? source.output;

  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(args ? { args } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(status ? { status } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(insertedAtContentLength !== undefined ? { insertedAtContentLength } : {}),
    ...(contentSnapshotAtStart !== undefined ? { contentSnapshotAtStart } : {}),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readToolCallStatus(value: unknown): OpenClawToolCallRecord["status"] | undefined {
  return value === "pending" || value === "running" || value === "complete" || value === "error"
    ? value
    : undefined;
}

function readTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function appendReplyBlock(current: string, next: string): string {
  if (!next.trim()) {
    return current;
  }
  if (!current) {
    return next;
  }
  if (next.startsWith(current)) {
    return next;
  }
  return `${current}${next}`;
}

export function buildCowtailInboundBody(params: {
  runtime: CowtailInboundRuntime;
  route: CowtailRoute;
  text: string;
  timestamp: number;
}): {
  body: string;
  storePath: string;
} {
  const cfg = params.runtime.config.loadConfig();
  const storePath = params.runtime.agent.session.resolveStorePath(cfg.session?.store, {
    agentId: params.route.agentId,
  });
  const previousTimestamp = params.runtime.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: params.route.sessionKey,
  });
  const envelope = params.runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const envelopeParams = {
    channel: CHANNEL_LABEL,
    from: SENDER_LABEL,
    timestamp: params.timestamp,
    envelope,
    body: params.text,
    ...(previousTimestamp !== undefined ? { previousTimestamp } : {}),
  };
  const body = params.runtime.channel.reply.formatAgentEnvelope(envelopeParams);

  return {
    body,
    storePath,
  };
}

function finalizeInboundContext(params: {
  runtime: CowtailInboundRuntime;
  account: ResolvedCowtailAccount;
  route: CowtailRoute;
  thread: OpenClawThreadRecord;
  itemId: string;
  text: string;
  body: string;
  timestamp: number;
}) {
  const target = buildCowtailTarget(params.thread.id);
  return params.runtime.channel.reply.finalizeInboundContext(
    {
      Body: params.body,
      BodyForAgent: params.text,
      RawBody: params.text,
      CommandBody: params.text,
      From: SENDER_ADDRESS,
      To: target,
      SessionKey: params.route.sessionKey,
      AccountId: params.account.accountId,
      ChatType: "direct" as const,
      ConversationLabel: params.thread.title,
      SenderName: SENDER_LABEL,
      SenderId: SENDER_ID,
      Provider: CHANNEL_ID,
      Surface: CHANNEL_ID,
      MessageSid: params.itemId,
      MessageSidFull: params.itemId,
      Timestamp: params.timestamp,
      OriginatingChannel: CHANNEL_ID,
      OriginatingTo: target,
      CommandAuthorized: true,
    },
    {
      forceBodyForAgent: true,
      forceBodyForCommands: true,
      forceChatType: true,
      forceConversationLabel: true,
    },
  );
}

function resolveThreadRoute(params: {
  thread: OpenClawThreadRecord;
  account: ResolvedCowtailAccount;
  runtime: CowtailInboundRuntime;
  logger?: Logger;
}): CowtailRoute | null {
  if (params.thread.targetAgent !== "default") {
    params.logger?.warn?.(
      `Cowtail thread ${params.thread.id} targeted unsupported agent ${params.thread.targetAgent}`,
    );
    return null;
  }
  if (!isSupportedCowtailAgent(params.account.agentId)) {
    params.logger?.warn?.(
      `Cowtail account ${params.account.accountId} targeted unsupported agent ${params.account.agentId}`,
    );
    return null;
  }
  if (params.thread.sessionKey) {
    return {
      agentId: params.account.agentId,
      sessionKey: params.thread.sessionKey,
    };
  }

  const route = params.runtime.channel.routing.resolveAgentRoute({
    cfg: params.runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: params.account.accountId,
    peer: {
      kind: "direct",
      id: buildCowtailTarget(params.thread.id),
    },
  });
  if (!isSupportedCowtailAgent(route.agentId)) {
    params.logger?.warn?.(
      `Cowtail thread ${params.thread.id} resolved unsupported agent ${route.agentId}`,
    );
    return null;
  }

  return {
    agentId: route.agentId,
    sessionKey: route.sessionKey,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
