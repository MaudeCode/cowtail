import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import type {
  OpenClawActionRecord,
  OpenClawEventEnvelope,
  OpenClawMessageRecord,
  OpenClawThreadRecord,
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
        dispatcherOptions: Record<string, unknown>;
        replyOptions?: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
};
type DispatchInboundCore = Parameters<typeof dispatchInboundReplyWithBase>[0]["core"];
type CowtailInboundClient = Pick<CowtailRealtimeClient, "sendSessionBound" | "sendActionResult">;
type CowtailRoute = {
  agentId: string;
  sessionKey: string;
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

      await dispatchCowtailTextTurn({
        account,
        runtime,
        route,
        thread,
        message,
        ...(logger ? { logger } : {}),
      });

      if (!thread.sessionKey) {
        await client.sendSessionBound({
          type: "openclaw_session_bound",
          threadId: thread.id,
          sessionKey: route.sessionKey,
        });
      }
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
          actionId: action.id,
          state: dispatchSucceeded ? "submitted" : "failed",
        });
      } catch (error) {
        logger?.error?.(`Cowtail action dispatch failed: ${errorMessage(error)}`);
        await client.sendActionResult({
          type: "openclaw_action_result",
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
  runtime: CowtailInboundRuntime;
  logger?: Logger;
  route: CowtailRoute;
  thread: OpenClawThreadRecord;
  message: OpenClawMessageRecord;
}): Promise<void> {
  const { account, runtime, logger, route, thread, message } = params;
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

  await dispatchInboundReplyWithBase({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core: runtime as unknown as DispatchInboundCore,
    deliver: async () => undefined,
    onRecordError: (error) => {
      logger?.error?.(`Cowtail inbound session record failed: ${errorMessage(error)}`);
    },
    onDispatchError: (error, info) => {
      logger?.error?.(`Cowtail ${info.kind} reply failed: ${errorMessage(error)}`);
    },
  });
}

export async function dispatchCowtailActionTurn(params: {
  account: ResolvedCowtailAccount;
  runtime: CowtailInboundRuntime;
  logger?: Logger;
  route: CowtailRoute;
  thread: OpenClawThreadRecord;
  action: OpenClawActionRecord;
  payload: Record<string, unknown>;
  timestamp: number;
}): Promise<boolean> {
  const { account, runtime, logger, route, thread, action, payload, timestamp } = params;
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

  await dispatchInboundReplyWithBase({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core: runtime as unknown as DispatchInboundCore,
    deliver: async () => undefined,
    onRecordError: (error) => {
      logger?.error?.(`Cowtail inbound session record failed: ${errorMessage(error)}`);
    },
    onDispatchError: (error, info) => {
      dispatchFailed = true;
      logger?.error?.(`Cowtail ${info.kind} reply failed: ${errorMessage(error)}`);
    },
  });

  return !dispatchFailed;
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
