import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type {
  CowtailCoreConfig,
  ResolvedCowtailAccount,
} from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_MIN_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;

function readCowtailConfig(cfg: OpenClawConfig | CowtailCoreConfig) {
  return (cfg as CowtailCoreConfig).channels?.cowtail ?? {};
}

function normalizeUrl(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizePositiveInteger(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    return fallback;
  }
  return raw;
}

function resolveBridgeToken(configValue: unknown): {
  token: string;
  source: ResolvedCowtailAccount["bridgeTokenSource"];
} {
  const fromConfig = normalizeResolvedSecretInputString({
    value: configValue,
    path: "channels.cowtail.bridgeToken",
  });
  if (fromConfig) {
    return { token: fromConfig, source: "config" };
  }
  const fromEnv = process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN?.trim();
  if (fromEnv) {
    return { token: fromEnv, source: "env" };
  }
  return { token: "", source: "none" };
}

export function listCowtailAccountIds(cfg: OpenClawConfig | CowtailCoreConfig): string[] {
  const channelCfg = readCowtailConfig(cfg);
  const url = normalizeUrl(channelCfg.url);
  const token = resolveBridgeToken(channelCfg.bridgeToken).token;
  return url || token ? [DEFAULT_ACCOUNT_ID] : [];
}

export function resolveCowtailAccount(
  cfg: OpenClawConfig | CowtailCoreConfig,
): ResolvedCowtailAccount {
  const channelCfg = readCowtailConfig(cfg);
  const agentId = channelCfg.agentId?.trim() || "main";
  if (agentId !== "main") {
    throw new Error('Cowtail channel v1 only supports agentId "main"');
  }

  const bridgeToken = resolveBridgeToken(channelCfg.bridgeToken);
  const url = normalizeUrl(channelCfg.url);
  const configured = Boolean(url && bridgeToken.token);

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled: channelCfg.enabled !== false,
    configured,
    url,
    bridgeToken: bridgeToken.token,
    bridgeTokenSource: bridgeToken.source,
    agentId: "main",
    connectTimeoutMs: normalizePositiveInteger(
      channelCfg.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
    reconnectMinDelayMs: normalizePositiveInteger(
      channelCfg.reconnectMinDelayMs,
      DEFAULT_RECONNECT_MIN_DELAY_MS,
    ),
    reconnectMaxDelayMs: normalizePositiveInteger(
      channelCfg.reconnectMaxDelayMs,
      DEFAULT_RECONNECT_MAX_DELAY_MS,
    ),
  };
}
