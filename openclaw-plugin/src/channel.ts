import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";

import { listCowtailAccountIds, resolveCowtailAccount } from "./accounts.js";
import { CowtailRealtimeClient } from "./client.js";
import { handleCowtailEvent } from "./inbound.js";
import { sendCowtailText } from "./outbound.js";
import { getCowtailRuntime } from "./runtime.js";
import {
  buildCowtailTarget,
  isSupportedCowtailAgent,
  normalizeCowtailTarget,
} from "./session-keys.js";
import { CowtailStateStore } from "./state-store.js";

const CHANNEL_ID = "cowtail";
const CHANNEL_LABEL = "Cowtail";
const CHANNEL_DOCS_PATH = "/channels/cowtail";
const CHANNEL_BLURB = "Send OpenClaw threads through Cowtail mobile realtime.";

const activeClients = new Map<string, CowtailRealtimeClient>();
const activeRunGenerations = new Map<string, number>();

type CowtailChannelDeps = {
  createStateStore: (stateDir: string, accountId: string) => CowtailStateStore;
  createClient: (params: ConstructorParameters<typeof CowtailRealtimeClient>[0]) => CowtailRealtimeClient;
  handleEvent: typeof handleCowtailEvent;
  sendText: typeof sendCowtailText;
  waitForAbort: typeof waitUntilAbort;
  resolveRuntime: typeof getCowtailRuntime;
};

const defaultDeps: CowtailChannelDeps = {
  createStateStore: (stateDir, accountId) => new CowtailStateStore(stateDir, accountId),
  createClient: (params) => new CowtailRealtimeClient(params),
  handleEvent: handleCowtailEvent,
  sendText: sendCowtailText,
  waitForAbort: waitUntilAbort,
  resolveRuntime: getCowtailRuntime,
};

function resolveAccountId(accountId?: string | null): string {
  const normalized = (accountId ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
  if (normalized !== DEFAULT_ACCOUNT_ID) {
    throw new Error(`Cowtail only supports the ${DEFAULT_ACCOUNT_ID} account`);
  }
  return normalized;
}

function resolveEventTimestamp(event: unknown): number {
  if (typeof event !== "object" || event === null) {
    return Date.now();
  }
  const createdAt = (event as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now();
}

function tokenStatusForAccount(account: ReturnType<typeof resolveCowtailAccount>): string {
  return account.bridgeToken ? "configured" : "missing";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startRunGeneration(accountId: string): number {
  const nextGeneration = (activeRunGenerations.get(accountId) ?? 0) + 1;
  activeRunGenerations.set(accountId, nextGeneration);
  return nextGeneration;
}

export function createCowtailChannelPlugin(
  deps: CowtailChannelDeps = defaultDeps,
) {
  return createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: CHANNEL_LABEL,
      selectionLabel: CHANNEL_LABEL,
      detailLabel: CHANNEL_LABEL,
      docsPath: CHANNEL_DOCS_PATH,
      docsLabel: CHANNEL_ID,
      blurb: CHANNEL_BLURB,
      systemImage: "message",
      order: 95,
    },
    capabilities: {
      chatTypes: ["direct"],
      threads: true,
      reply: true,
      media: false,
      reactions: false,
      edit: false,
      unsend: false,
      blockStreaming: false,
    },
    setup: {
      applyAccountConfig: ({ cfg }) => cfg,
    },
    config: {
      listAccountIds: (cfg) => listCowtailAccountIds(cfg),
      resolveAccount: (cfg, accountId) => {
        resolveAccountId(accountId);
        return resolveCowtailAccount(cfg);
      },
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      isConfigured: (account) => account.configured,
      hasConfiguredState: ({ cfg }) => listCowtailAccountIds(cfg).length > 0,
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        running: false,
        connected: false,
        tokenSource: account.bridgeTokenSource,
        tokenStatus: tokenStatusForAccount(account),
      }),
    },
    gateway: {
      startAccount: async (ctx) => {
        const accountId = resolveAccountId(ctx.accountId);
        const account = resolveCowtailAccount(ctx.cfg);
        if (!account.configured) {
          throw new Error("Cowtail account is not configured");
        }

        const runGeneration = startRunGeneration(accountId);
        const isCurrentRun = () => activeRunGenerations.get(accountId) === runGeneration;
        const runtime = deps.resolveRuntime();
        const stateDir = runtime.state.resolveStateDir(process.env);
        const stateStore = deps.createStateStore(stateDir, accountId);
        const setStatus = (patch: Record<string, unknown>) => {
          if (!isCurrentRun()) {
            return;
          }
          ctx.setStatus({
            ...ctx.getStatus(),
            accountId,
            ...patch,
          });
        };

        let client!: CowtailRealtimeClient;
        const logger = {
          warn: (message: string) => {
            ctx.log?.warn(message);
          },
          error: (message: string) => {
            ctx.log?.error(message);
            setStatus({
              lastError: message,
            });
          },
        };

        client = deps.createClient({
          account,
          stateStore,
          logger,
          onEvent: async (event) => {
            const timestamp = resolveEventTimestamp(event);
            const currentStatus = ctx.getStatus();
            const nextStatus: Record<string, unknown> = {
              lastEventAt: timestamp,
              lastError: null,
            };
            if (!currentStatus.connected) {
              nextStatus.connected = true;
              nextStatus.lastConnectedAt = timestamp;
            }
            setStatus(nextStatus);
            try {
              await deps.handleEvent({
                event,
                account,
                client,
                runtime: runtime as never,
                ...(ctx.log ? { logger: ctx.log } : {}),
              });
            } catch (error) {
              setStatus({
                lastError: errorMessage(error),
              });
              throw error;
            }
          },
        });

        const previous = activeClients.get(accountId);
        if (previous) {
          previous.stop();
        }
        activeClients.set(accountId, client);

        setStatus({
          running: true,
          connected: false,
          lastError: null,
        });
        client.start();

        try {
          await deps.waitForAbort(ctx.abortSignal, async () => {
            if (activeClients.get(accountId) === client) {
              activeClients.delete(accountId);
            }
            client.stop();
            setStatus({
              running: false,
              connected: false,
              lastDisconnect: {
                at: Date.now(),
              },
            });
          });
        } catch (error) {
          const message = errorMessage(error);
          setStatus({
            running: false,
            connected: false,
            lastDisconnect: {
              at: Date.now(),
              error: message,
            },
            lastError: message,
          });
          throw error;
        } finally {
          if (activeClients.get(accountId) === client) {
            activeClients.delete(accountId);
          }
          if (isCurrentRun()) {
            activeRunGenerations.delete(accountId);
          }
        }
      },
    },
    messaging: {
      normalizeTarget: (raw) => normalizeCowtailTarget(raw) || undefined,
      resolveOutboundSessionRoute: (params) => {
        if (!isSupportedCowtailAgent(params.agentId)) {
          throw new Error('Cowtail channel only supports agentId "main"');
        }

        const accountId = resolveAccountId(params.accountId);
        const target = normalizeCowtailTarget(params.target);
        if (!target) {
          return null;
        }

        const formattedTarget = buildCowtailTarget(target);
        return buildChannelOutboundSessionRoute({
          cfg: params.cfg,
          agentId: "main",
          channel: CHANNEL_ID,
          accountId,
          peer: {
            kind: "direct",
            id: target,
          },
          chatType: "direct",
          from: formattedTarget,
          to: formattedTarget,
          ...(params.threadId != null ? { threadId: params.threadId } : {}),
        });
      },
    },
    outbound: {
      deliveryMode: "direct",
      sendText: async (ctx) => {
        const accountId = resolveAccountId(ctx.accountId);
        const account = resolveCowtailAccount(ctx.cfg);
        if (!account.configured) {
          throw new Error("Cowtail account is not configured");
        }

        const client = activeClients.get(accountId);
        if (!client) {
          throw new Error(`Cowtail account ${accountId} is not running`);
        }

        return deps.sendText({
          account,
          client,
          to: ctx.to,
          text: ctx.text,
        });
      },
    },
  },
  });
}

export const cowtailChannelPlugin = createCowtailChannelPlugin();
