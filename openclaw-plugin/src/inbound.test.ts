import { describe, expect, test } from "bun:test";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";

import type { OpenClawEventEnvelope } from "@maudecode/cowtail-protocol";

import { buildCowtailTarget } from "./session-keys.js";
import type { ResolvedCowtailAccount } from "./types.js";
import { handleCowtailEvent } from "./inbound.js";

type Logger = {
  warn: (message: string) => void;
  error: (message: string) => void;
};

type RouteCall = {
  cfg: unknown;
  channel: string;
  accountId: string;
  peer: {
    kind: string;
    id: string;
  };
};

type RecordCall = {
  storePath: string;
  sessionKey: string;
  ctx: Record<string, unknown>;
  onRecordError?: (err: unknown) => void;
};

type DispatchCall = {
  ctx: Record<string, unknown>;
  cfg: unknown;
  dispatcherOptions: Record<string, unknown>;
  replyOptions?: Record<string, unknown>;
};

type FakeRuntime = {
  config: {
    loadConfig: () => OpenClawConfig;
    writeConfigFile: (cfg: OpenClawConfig) => Promise<void>;
  };
  agent: {
    session: {
      resolveStorePath: (
        store?: string | undefined,
        opts?: { agentId?: string; env?: NodeJS.ProcessEnv },
      ) => string;
    };
  };
  channel: {
    routing: {
      resolveAgentRoute: (params: RouteCall) => {
        agentId: string;
        sessionKey: string;
      };
    };
    session: {
      readSessionUpdatedAt: (params: { storePath: string; sessionKey: string }) => number | undefined;
      recordInboundSession: (params: RecordCall) => Promise<void>;
    };
    reply: {
      resolveEnvelopeFormatOptions: (cfg?: OpenClawConfig) => { timezone?: string };
      formatAgentEnvelope: (params: {
        channel: string;
        from: string;
        timestamp?: number;
        previousTimestamp?: number;
        envelope: Record<string, unknown>;
        body: string;
      }) => string;
      finalizeInboundContext: <T extends Record<string, unknown>>(ctx: T) => T & { finalized: true };
      dispatchReplyWithBufferedBlockDispatcher: (params: DispatchCall) => Promise<void>;
    };
  };
};

type FakeClient = {
  sendSessionBoundCalls: Array<{
    type: "openclaw_session_bound";
    threadId: string;
    sessionKey: string;
  }>;
  sendActionResultCalls: Array<{
    type: "openclaw_action_result";
    actionId: string;
    state: "submitted" | "failed" | "expired";
    resultMetadata?: Record<string, unknown>;
  }>;
  sendSessionBound: (input: {
    type: "openclaw_session_bound";
    threadId: string;
    sessionKey: string;
  }) => Promise<number | undefined>;
  sendActionResult: (input: {
    type: "openclaw_action_result";
    actionId: string;
    state: "submitted" | "failed" | "expired";
    resultMetadata?: Record<string, unknown>;
  }) => Promise<number | undefined>;
};

function createAccount(
  overrides: Partial<ResolvedCowtailAccount> = {},
): ResolvedCowtailAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    url: "wss://cowtail.example.invalid/openclaw/realtime",
    bridgeToken: "bridge-token",
    bridgeTokenSource: "config",
    agentId: "main",
    connectTimeoutMs: 5_000,
    reconnectMinDelayMs: 100,
    reconnectMaxDelayMs: 250,
    ...overrides,
  };
}

function createClient(): FakeClient {
  const sendSessionBoundCalls: FakeClient["sendSessionBoundCalls"] = [];
  const sendActionResultCalls: FakeClient["sendActionResultCalls"] = [];

  return {
    sendSessionBoundCalls,
    sendActionResultCalls,
    async sendSessionBound(input) {
      sendSessionBoundCalls.push(input);
      return undefined;
    },
    async sendActionResult(input) {
      sendActionResultCalls.push(input);
      return undefined;
    },
  };
}

function createLogger(): { logger: Logger; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  return {
    warnings,
    errors,
    logger: {
      warn(message) {
        warnings.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  };
}

function createRuntime(overrides?: {
  route?: {
    agentId: string;
    sessionKey: string;
  };
  readSessionUpdatedAt?: number;
  dispatchError?: Error;
}) {
  const cfg: OpenClawConfig = {
    session: {
      store: "sessions.json",
    },
  };
  const routeCalls: RouteCall[] = [];
  const storePathCalls: Array<{ store: string | undefined; agentId: string }> = [];
  const readSessionUpdatedAtCalls: Array<{ storePath: string; sessionKey: string }> = [];
  const formatAgentEnvelopeCalls: Array<{
    channel: string;
    from: string;
    timestamp?: number;
    previousTimestamp?: number;
    envelope: Record<string, unknown>;
    body: string;
  }> = [];
  const recordInboundSessionCalls: RecordCall[] = [];
  const dispatchCalls: DispatchCall[] = [];

  const runtime: FakeRuntime = {
    config: {
      loadConfig: () => cfg,
      async writeConfigFile() {
        return undefined;
      },
    },
    agent: {
      session: {
        resolveStorePath(store, opts) {
          const agentId = opts?.agentId ?? "unknown";
          storePathCalls.push({ store, agentId });
          return `/tmp/${agentId}-${store ?? "session-store.json"}`;
        },
      },
    },
    channel: {
      routing: {
        resolveAgentRoute(params) {
          routeCalls.push(params);
          return overrides?.route ?? { agentId: "main", sessionKey: "session-routed" };
        },
      },
      session: {
        readSessionUpdatedAt(params) {
          readSessionUpdatedAtCalls.push(params);
          return overrides?.readSessionUpdatedAt;
        },
        async recordInboundSession(params) {
          recordInboundSessionCalls.push(params);
        },
      },
      reply: {
        resolveEnvelopeFormatOptions() {
          return { timezone: "utc" };
        },
        formatAgentEnvelope(params) {
          formatAgentEnvelopeCalls.push(params);
          return `ENVELOPE:${params.body}`;
        },
        finalizeInboundContext(ctx) {
          return {
            ...ctx,
            finalized: true as const,
          };
        },
        async dispatchReplyWithBufferedBlockDispatcher(params) {
          dispatchCalls.push(params);
          if (overrides?.dispatchError) {
            throw overrides.dispatchError;
          }
        },
      },
    },
  };

  return {
    runtime,
    cfg,
    routeCalls,
    storePathCalls,
    readSessionUpdatedAtCalls,
    formatAgentEnvelopeCalls,
    recordInboundSessionCalls,
    dispatchCalls,
  };
}

describe("handleCowtailEvent", () => {
  test("thread_created for a pending iOS thread dispatches the initial message and binds the session", async () => {
    const client = createClient();
    const { logger } = createLogger();
    const runtimeState = createRuntime({
      route: {
        agentId: "main",
        sessionKey: "session-thread-created",
      },
      readSessionUpdatedAt: 111,
    });
    const event: OpenClawEventEnvelope = {
      sequence: 1,
      type: "thread_created",
      createdAt: 1_700_000_000_000,
      threadId: "thread-1",
      messageId: "message-1",
      thread: {
        id: "thread-1",
        status: "pending",
        targetAgent: "default",
        title: "Initial thread",
        unreadCount: 0,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      message: {
        id: "message-1",
        threadId: "thread-1",
        direction: "user_to_openclaw",
        text: "Start here",
        links: [],
        deliveryState: "pending",
        createdAt: 1_700_000_000_001,
        updatedAt: 1_700_000_000_001,
      },
    };

    await handleCowtailEvent({
      event,
      account: createAccount(),
      client,
      runtime: runtimeState.runtime,
      logger,
    });

    expect(runtimeState.routeCalls).toEqual([
      {
        cfg: runtimeState.cfg,
        channel: "cowtail",
        accountId: "default",
        peer: {
          kind: "direct",
          id: buildCowtailTarget("thread-1"),
        },
      },
    ]);
    expect(runtimeState.storePathCalls).toEqual([
      { store: "sessions.json", agentId: "main" },
    ]);
    expect(runtimeState.readSessionUpdatedAtCalls).toEqual([
      {
        storePath: "/tmp/main-sessions.json",
        sessionKey: "session-thread-created",
      },
    ]);
    expect(runtimeState.formatAgentEnvelopeCalls).toEqual([
      {
        channel: "Cowtail",
        from: "Cowtail iOS",
        timestamp: 1_700_000_000_001,
        previousTimestamp: 111,
        envelope: { timezone: "utc" },
        body: "Start here",
      },
    ]);
    expect(runtimeState.recordInboundSessionCalls).toHaveLength(1);
    expect(runtimeState.dispatchCalls).toHaveLength(1);
    expect(runtimeState.dispatchCalls[0]!.ctx).toMatchObject({
      Body: "ENVELOPE:Start here",
      BodyForAgent: "Start here",
      RawBody: "Start here",
      CommandBody: "Start here",
      From: "cowtail:ios",
      To: "cowtail:thread-1",
      SessionKey: "session-thread-created",
      AccountId: "default",
      ChatType: "direct",
      ConversationLabel: "Initial thread",
      SenderName: "Cowtail iOS",
      SenderId: "cowtail-ios",
      Provider: "cowtail",
      Surface: "cowtail",
      MessageSid: "message-1",
      MessageSidFull: "message-1",
      Timestamp: 1_700_000_000_001,
      OriginatingChannel: "cowtail",
      OriginatingTo: "cowtail:thread-1",
      CommandAuthorized: true,
      finalized: true,
    });
    expect(client.sendSessionBoundCalls).toEqual([
      {
        type: "openclaw_session_bound",
        threadId: "thread-1",
        sessionKey: "session-thread-created",
      },
    ]);
    expect(client.sendActionResultCalls).toEqual([]);
  });

  test("reply_created dispatches into the bound session without creating a new session", async () => {
    const client = createClient();
    const { logger } = createLogger();
    const runtimeState = createRuntime();
    const event: OpenClawEventEnvelope = {
      sequence: 2,
      type: "reply_created",
      createdAt: 1_700_000_000_010,
      threadId: "thread-2",
      messageId: "message-2",
      thread: {
        id: "thread-2",
        sessionKey: "session-existing",
        status: "active",
        targetAgent: "default",
        title: "Bound thread",
        unreadCount: 0,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_010,
      },
      message: {
        id: "message-2",
        threadId: "thread-2",
        direction: "user_to_openclaw",
        text: "Follow-up",
        links: [],
        deliveryState: "pending",
        createdAt: 1_700_000_000_010,
        updatedAt: 1_700_000_000_010,
      },
    };

    await handleCowtailEvent({
      event,
      account: createAccount(),
      client,
      runtime: runtimeState.runtime,
      logger,
    });

    expect(runtimeState.routeCalls).toEqual([]);
    expect(runtimeState.dispatchCalls).toHaveLength(1);
    expect(runtimeState.dispatchCalls[0]!.ctx).toMatchObject({
      SessionKey: "session-existing",
      BodyForAgent: "Follow-up",
      To: "cowtail:thread-2",
      MessageSid: "message-2",
    });
    expect(client.sendSessionBoundCalls).toEqual([]);
    expect(client.sendActionResultCalls).toEqual([]);
  });

  test("action_submitted dispatches action text into the bound session and records submitted", async () => {
    const client = createClient();
    const { logger } = createLogger();
    const runtimeState = createRuntime();
    const event: OpenClawEventEnvelope = {
      sequence: 3,
      type: "action_submitted",
      createdAt: 1_700_000_000_020,
      threadId: "thread-3",
      actionId: "action-1",
      thread: {
        id: "thread-3",
        sessionKey: "session-action",
        status: "active",
        targetAgent: "default",
        title: "Action thread",
        unreadCount: 0,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_020,
      },
      action: {
        id: "action-1",
        threadId: "thread-3",
        messageId: "message-3",
        label: "Approve",
        kind: "approval",
        payload: { decision: "approve", nested: { now: true } },
        state: "submitted",
        createdAt: 1_700_000_000_015,
        updatedAt: 1_700_000_000_020,
      },
      payload: { decision: "approve", nested: { now: true } },
    };

    await handleCowtailEvent({
      event,
      account: createAccount(),
      client,
      runtime: runtimeState.runtime,
      logger,
    });

    expect(runtimeState.routeCalls).toEqual([]);
    expect(runtimeState.dispatchCalls).toHaveLength(1);
    expect(runtimeState.dispatchCalls[0]!.ctx).toMatchObject({
      SessionKey: "session-action",
      BodyForAgent:
        'Cowtail action selected: Approve\nkind: approval\npayload: {"decision":"approve","nested":{"now":true}}',
      RawBody:
        'Cowtail action selected: Approve\nkind: approval\npayload: {"decision":"approve","nested":{"now":true}}',
      CommandBody:
        'Cowtail action selected: Approve\nkind: approval\npayload: {"decision":"approve","nested":{"now":true}}',
      MessageSid: "action-1",
      MessageSidFull: "action-1",
      To: "cowtail:thread-3",
    });
    expect(client.sendActionResultCalls).toEqual([
      {
        type: "openclaw_action_result",
        actionId: "action-1",
        state: "submitted",
      },
    ]);
  });

  test("dispatch failure for action_submitted records failed", async () => {
    const client = createClient();
    const { logger, errors } = createLogger();
    const runtimeState = createRuntime({
      dispatchError: new Error("dispatch exploded"),
    });
    const event: OpenClawEventEnvelope = {
      sequence: 4,
      type: "action_submitted",
      createdAt: 1_700_000_000_030,
      threadId: "thread-4",
      actionId: "action-2",
      thread: {
        id: "thread-4",
        sessionKey: "session-action-failure",
        status: "active",
        targetAgent: "default",
        title: "Action thread failure",
        unreadCount: 0,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_030,
      },
      action: {
        id: "action-2",
        threadId: "thread-4",
        messageId: "message-4",
        label: "Reject",
        kind: "approval",
        payload: { decision: "reject" },
        state: "submitted",
        createdAt: 1_700_000_000_025,
        updatedAt: 1_700_000_000_030,
      },
      payload: { decision: "reject" },
    };

    await expect(
      handleCowtailEvent({
        event,
        account: createAccount(),
        client,
        runtime: runtimeState.runtime,
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(client.sendActionResultCalls).toEqual([
      {
        type: "openclaw_action_result",
        actionId: "action-2",
        state: "failed",
      },
    ]);
    expect(errors).toEqual([
      "Cowtail action dispatch failed: dispatch exploded",
    ]);
  });

  test("events missing required thread, message, or action content are ignored with a warning", async () => {
    const client = createClient();
    const { logger, warnings } = createLogger();
    const runtimeState = createRuntime();

    await handleCowtailEvent({
      event: {
        sequence: 5,
        type: "thread_created",
        createdAt: 1_700_000_000_040,
        threadId: "thread-5",
        thread: {
          id: "thread-5",
          status: "pending",
          targetAgent: "default",
          title: "Missing message",
          unreadCount: 0,
          createdAt: 1_700_000_000_040,
          updatedAt: 1_700_000_000_040,
        },
      },
      account: createAccount(),
      client,
      runtime: runtimeState.runtime,
      logger,
    });

    await handleCowtailEvent({
      event: {
        sequence: 6,
        type: "reply_created",
        createdAt: 1_700_000_000_050,
        threadId: "thread-6",
        thread: {
          id: "thread-6",
          sessionKey: "session-thread-6",
          status: "active",
          targetAgent: "default",
          title: "Missing reply",
          unreadCount: 0,
          createdAt: 1_700_000_000_050,
          updatedAt: 1_700_000_000_050,
        },
      },
      account: createAccount(),
      client,
      runtime: runtimeState.runtime,
      logger,
    });

    await handleCowtailEvent({
      event: {
        sequence: 7,
        type: "action_submitted",
        createdAt: 1_700_000_000_060,
        threadId: "thread-7",
        actionId: "action-7",
        thread: {
          id: "thread-7",
          sessionKey: "session-thread-7",
          status: "active",
          targetAgent: "default",
          title: "Missing action",
          unreadCount: 0,
          createdAt: 1_700_000_000_060,
          updatedAt: 1_700_000_000_060,
        },
        payload: { ignored: true },
      },
      account: createAccount(),
      client,
      runtime: runtimeState.runtime,
      logger,
    });

    expect(warnings).toEqual([
      "Cowtail thread_created event missing thread or message payload",
      "Cowtail reply_created event missing thread or message payload",
      "Cowtail action_submitted event missing thread or action payload",
    ]);
    expect(runtimeState.routeCalls).toEqual([]);
    expect(runtimeState.recordInboundSessionCalls).toEqual([]);
    expect(runtimeState.dispatchCalls).toEqual([]);
    expect(client.sendSessionBoundCalls).toEqual([]);
    expect(client.sendActionResultCalls).toEqual([]);
  });
});
