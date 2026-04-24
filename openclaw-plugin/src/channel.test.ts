import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";

import { listCowtailAccountIds, resolveCowtailAccount } from "./accounts.js";
import { createCowtailChannelPlugin } from "./channel.js";
import type { CowtailRealtimeClientDeps } from "./client.js";

type FakeClientDeps = CowtailRealtimeClientDeps;

class FakeCowtailRealtimeClient {
  readonly deps: FakeClientDeps;
  started = false;
  stopped = false;

  constructor(deps: FakeClientDeps) {
    this.deps = deps;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

const stateStoreCreations: Array<{ stateDir: string; accountId: string }> = [];
const waitUntilAbortCalls: Array<{
  signal: AbortSignal | undefined;
  onAbort: (() => void | Promise<void>) | undefined;
}> = [];
const clientInstances: FakeCowtailRealtimeClient[] = [];

let waitUntilAbortImpl: (
  signal?: AbortSignal,
  onAbort?: () => void | Promise<void>,
) => Promise<void> = async (_signal, onAbort) => {
  await onAbort?.();
};

const handleCowtailEventMock = mock(async (_params: unknown) => undefined);
const sendCowtailTextMock = mock(async (_params: unknown) => ({
  channel: "cowtail",
  messageId: "sent-1",
  to: "cowtail:thread_123",
}));

function createConfig(overrides?: {
  url?: string;
  bridgeToken?: string;
  enabled?: boolean;
  agentId?: string;
}) {
  return {
    channels: {
      cowtail: {
        enabled: overrides?.enabled ?? true,
        url: overrides?.url ?? "wss://cowtail.example.invalid/openclaw/realtime",
        bridgeToken: overrides?.bridgeToken ?? "bridge-token",
        ...(overrides?.agentId ? { agentId: overrides.agentId } : {}),
      },
    },
  };
}

function createRuntime() {
  return {
    state: {
      resolveStateDir: () => "/tmp/openclaw-state",
    },
  };
}

function createGatewayContext(cfg = createConfig()) {
  const statusHistory: Array<Record<string, unknown>> = [];
  let currentStatus: Record<string, unknown> = {
    accountId: DEFAULT_ACCOUNT_ID,
  };

  return {
    ctx: {
      cfg,
      accountId: DEFAULT_ACCOUNT_ID,
      account: resolveCowtailAccount(cfg),
      runtime: createRuntime(),
      abortSignal: new AbortController().signal,
      getStatus: () => currentStatus,
      setStatus: (next: Record<string, unknown>) => {
        currentStatus = next;
        statusHistory.push(next);
      },
      log: {
        info: (_message: string) => undefined,
        warn: (_message: string) => undefined,
        error: (_message: string) => undefined,
      },
    },
    statusHistory,
    getCurrentStatus: () => currentStatus,
  };
}

function createSharedGatewayContexts(cfg = createConfig()) {
  const statusHistory: Array<Record<string, unknown>> = [];
  let currentStatus: Record<string, unknown> = {
    accountId: DEFAULT_ACCOUNT_ID,
  };

  function makeCtx() {
    return {
      cfg,
      accountId: DEFAULT_ACCOUNT_ID,
      account: resolveCowtailAccount(cfg),
      runtime: createRuntime(),
      abortSignal: new AbortController().signal,
      getStatus: () => currentStatus,
      setStatus: (next: Record<string, unknown>) => {
        currentStatus = next;
        statusHistory.push(next);
      },
      log: {
        info: (_message: string) => undefined,
        warn: (_message: string) => undefined,
        error: (_message: string) => undefined,
      },
    };
  }

  return {
    first: makeCtx(),
    second: makeCtx(),
    statusHistory,
    getCurrentStatus: () => currentStatus,
  };
}

function createPlugin() {
  return createCowtailChannelPlugin({
    createStateStore: (stateDir, accountId) => {
      stateStoreCreations.push({ stateDir, accountId });
      return {} as never;
    },
    createClient: (deps) => {
      const client = new FakeCowtailRealtimeClient(deps);
      clientInstances.push(client);
      return client as never;
    },
    handleEvent: handleCowtailEventMock as never,
    sendText: sendCowtailTextMock as never,
    waitForAbort: async (signal, onAbort) => {
      waitUntilAbortCalls.push({ signal, onAbort });
      await waitUntilAbortImpl(signal, onAbort);
    },
    resolveRuntime: () => createRuntime() as never,
  });
}

beforeEach(() => {
  stateStoreCreations.length = 0;
  waitUntilAbortCalls.length = 0;
  clientInstances.length = 0;
  waitUntilAbortImpl = async (_signal, onAbort) => {
    await onAbort?.();
  };
  handleCowtailEventMock.mockClear();
  sendCowtailTextMock.mockClear();
});

describe("cowtailChannelPlugin", () => {
  test("exposes cowtail plugin id, meta, and capabilities", () => {
    const cowtailChannelPlugin = createPlugin();

    expect(cowtailChannelPlugin.id).toBe("cowtail");
    expect(cowtailChannelPlugin.meta).toMatchObject({
      id: "cowtail",
      label: "Cowtail",
      selectionLabel: "Cowtail",
      detailLabel: "Cowtail",
      docsPath: "/channels/cowtail",
      docsLabel: "cowtail",
      blurb: "Send OpenClaw threads through Cowtail mobile realtime.",
      systemImage: "message",
      order: 95,
    });
    expect(cowtailChannelPlugin.capabilities).toEqual({
      chatTypes: ["direct"],
      threads: true,
      reply: true,
      media: false,
      reactions: false,
      edit: false,
      unsend: false,
      blockStreaming: false,
    });
  });

  test("derives account listing, default account, and configured status from account resolution", () => {
    const cowtailChannelPlugin = createPlugin();
    const configuredCfg = createConfig();
    const unconfiguredCfg = createConfig({
      url: "",
      bridgeToken: "",
    });

    const configuredAccount = cowtailChannelPlugin.config.resolveAccount(
      configuredCfg,
      DEFAULT_ACCOUNT_ID,
    );
    const unconfiguredAccount = cowtailChannelPlugin.config.resolveAccount(
      unconfiguredCfg,
      DEFAULT_ACCOUNT_ID,
    );

    expect(cowtailChannelPlugin.config.listAccountIds(configuredCfg)).toEqual(
      listCowtailAccountIds(configuredCfg),
    );
    expect(cowtailChannelPlugin.config.defaultAccountId?.(configuredCfg)).toBe(DEFAULT_ACCOUNT_ID);
    expect(configuredAccount).toEqual(resolveCowtailAccount(configuredCfg));
    expect(cowtailChannelPlugin.config.isConfigured?.(configuredAccount, configuredCfg)).toBe(true);
    expect(cowtailChannelPlugin.config.isConfigured?.(unconfiguredAccount, unconfiguredCfg)).toBe(
      false,
    );
  });

  test("describes accounts without exposing the bridge token", () => {
    const cowtailChannelPlugin = createPlugin();
    const cfg = createConfig();
    const account = resolveCowtailAccount(cfg);

    const described = cowtailChannelPlugin.config.describeAccount?.(account, cfg);

    expect(described).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      enabled: true,
      configured: true,
      tokenSource: "config",
      tokenStatus: "configured",
    });
    expect(JSON.stringify(described)).not.toContain("bridge-token");
  });

  test("gateway.startAccount starts the realtime client, handles inbound events, and updates status", async () => {
    const cowtailChannelPlugin = createPlugin();
    const { ctx, statusHistory, getCurrentStatus } = createGatewayContext();
    const fakeEvent = {
      type: "thread_created",
      sequence: 1,
      createdAt: 1700000000000,
    };

    waitUntilAbortImpl = async (_signal, onAbort) => {
      await clientInstances[0]?.deps.onEvent(fakeEvent as never);
      await onAbort?.();
    };

    await cowtailChannelPlugin.gateway!.startAccount?.(ctx as never);

    expect(stateStoreCreations).toEqual([
      {
        stateDir: "/tmp/openclaw-state",
        accountId: DEFAULT_ACCOUNT_ID,
      },
    ]);
    expect(clientInstances).toHaveLength(1);
    expect(clientInstances[0]?.started).toBe(true);
    expect(clientInstances[0]?.stopped).toBe(true);
    expect(handleCowtailEventMock).toHaveBeenCalledTimes(1);
    expect(handleCowtailEventMock.mock.calls[0]?.[0]).toMatchObject({
      event: fakeEvent,
      account: resolveCowtailAccount(ctx.cfg),
    });
    expect(statusHistory[0]).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      running: true,
      connected: false,
      lastError: null,
    });
    expect(getCurrentStatus()).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: 1700000000000,
      lastEventAt: 1700000000000,
      lastError: null,
    });
    expect(getCurrentStatus().lastDisconnect).toEqual(
      expect.objectContaining({
        at: expect.any(Number),
      }),
    );
  });

  test("gateway.startAccount rejects unconfigured accounts", async () => {
    const cowtailChannelPlugin = createPlugin();
    const cfg = createConfig({
      url: "",
      bridgeToken: "",
    });
    const { ctx } = createGatewayContext(cfg);

    await expect(cowtailChannelPlugin.gateway!.startAccount?.(ctx as never)).rejects.toThrow(
      /not configured/i,
    );

    expect(clientInstances).toHaveLength(0);
    expect(waitUntilAbortCalls).toHaveLength(0);
  });

  test("outbound.sendText delegates to sendCowtailText with the active client", async () => {
    const cowtailChannelPlugin = createPlugin();
    const { ctx } = createGatewayContext();
    let releaseAbort!: () => void;

    waitUntilAbortImpl = async (_signal, onAbort) => {
      await new Promise<void>((resolve) => {
        releaseAbort = async () => {
          await onAbort?.();
          resolve();
        };
      });
    };

    const running = cowtailChannelPlugin.gateway!.startAccount?.(ctx as never);
    expect(clientInstances).toHaveLength(1);

    const result = await cowtailChannelPlugin.outbound!.sendText?.({
      cfg: ctx.cfg,
      accountId: DEFAULT_ACCOUNT_ID,
      to: "thread_123",
      text: "Hello world",
    } as never);

    expect(sendCowtailTextMock).toHaveBeenCalledTimes(1);
    expect(sendCowtailTextMock.mock.calls[0]?.[0]).toMatchObject({
      account: resolveCowtailAccount(ctx.cfg),
      client: clientInstances[0],
      to: "thread_123",
      text: "Hello world",
    });
    expect(result as Record<string, unknown>).toMatchObject({
      channel: "cowtail",
      messageId: "sent-1",
      to: "cowtail:thread_123",
    });

    await releaseAbort();
    await running;
  });

  test("outbound.sendText creates a transient client when no active client exists", async () => {
    const cowtailChannelPlugin = createPlugin();
    const cfg = createConfig();

    const result = await cowtailChannelPlugin.outbound!.sendText?.({
      cfg,
      accountId: DEFAULT_ACCOUNT_ID,
      to: "thread_fresh",
      text: "Hello from a fresh process",
    } as never);

    expect(stateStoreCreations).toEqual([
      {
        stateDir: "/tmp/openclaw-state",
        accountId: DEFAULT_ACCOUNT_ID,
      },
    ]);
    expect(clientInstances).toHaveLength(1);
    expect(clientInstances[0]?.started).toBe(true);
    expect(clientInstances[0]?.stopped).toBe(true);
    expect(sendCowtailTextMock).toHaveBeenCalledTimes(1);
    expect(sendCowtailTextMock.mock.calls[0]?.[0]).toMatchObject({
      account: resolveCowtailAccount(cfg),
      client: clientInstances[0],
      to: "thread_fresh",
      text: "Hello from a fresh process",
    });
    expect(result as Record<string, unknown>).toMatchObject({
      channel: "cowtail",
      messageId: "sent-1",
      to: "cowtail:thread_123",
    });
  });

  test("replacement lifecycle abort does not let the old run clobber current status", async () => {
    const cowtailChannelPlugin = createPlugin();
    const { first, second, getCurrentStatus } = createSharedGatewayContexts();
    const abortResolvers: Array<() => Promise<void>> = [];

    waitUntilAbortImpl = async (_signal, onAbort) => {
      await new Promise<void>((resolve) => {
        abortResolvers.push(async () => {
          await onAbort?.();
          resolve();
        });
      });
    };

    const firstRun = cowtailChannelPlugin.gateway!.startAccount?.(first as never);
    expect(clientInstances).toHaveLength(1);

    const secondRun = cowtailChannelPlugin.gateway!.startAccount?.(second as never);
    expect(clientInstances).toHaveLength(2);
    expect(clientInstances[0]?.stopped).toBe(true);

    await clientInstances[1]?.deps.onEvent({
      type: "thread_created",
      sequence: 2,
      createdAt: 1700000000001,
    } as never);

    expect(getCurrentStatus()).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      running: true,
      connected: true,
      lastConnectedAt: 1700000000001,
    });

    await abortResolvers[0]?.();

    expect(getCurrentStatus()).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      running: true,
      connected: true,
      lastConnectedAt: 1700000000001,
    });

    await abortResolvers[1]?.();
    await Promise.all([firstRun, secondRun]);
  });

  test("messaging.normalizeTarget strips the cowtail prefix", () => {
    const cowtailChannelPlugin = createPlugin();

    expect(cowtailChannelPlugin.messaging!.normalizeTarget?.("cowtail:thread_123")).toBe(
      "thread_123",
    );
    expect(cowtailChannelPlugin.messaging!.normalizeTarget?.("  cowtail:thread_123  ")).toBe(
      "thread_123",
    );
  });

  test("messaging.resolveOutboundSessionRoute rejects non-main agent ids", () => {
    const cowtailChannelPlugin = createPlugin();

    expect(() =>
      cowtailChannelPlugin.messaging!.resolveOutboundSessionRoute?.({
        cfg: createConfig(),
        agentId: "ops",
        accountId: DEFAULT_ACCOUNT_ID,
        target: "thread_123",
      }),
    ).toThrow(/main/);
  });

  test("messaging.targetResolver resolves direct Cowtail thread targets after directory fallback", async () => {
    const cowtailChannelPlugin = createPlugin();

    await expect(
      cowtailChannelPlugin.messaging!.targetResolver?.resolveTarget?.({
        cfg: createConfig(),
        accountId: DEFAULT_ACCOUNT_ID,
        input: "smoke",
        normalized: "smoke",
        preferredKind: "group",
      }),
    ).resolves.toEqual({
      to: "cowtail:smoke",
      kind: "user",
      source: "normalized",
    });
  });
});
