import type { SecretInput } from "openclaw/plugin-sdk/secret-input";

export type CowtailChannelConfig = {
  enabled?: boolean;
  url?: string;
  bridgeToken?: SecretInput;
  agentId?: string;
  connectTimeoutMs?: number;
  reconnectMinDelayMs?: number;
  reconnectMaxDelayMs?: number;
};

export type CowtailCoreConfig = {
  channels?: {
    cowtail?: CowtailChannelConfig;
  };
};

export type CowtailBridgeTokenSource = "config" | "env" | "none";

export type ResolvedCowtailAccount = {
  accountId: "default";
  enabled: boolean;
  configured: boolean;
  url: string;
  bridgeToken: string;
  bridgeTokenSource: CowtailBridgeTokenSource;
  agentId: "main";
  connectTimeoutMs: number;
  reconnectMinDelayMs: number;
  reconnectMaxDelayMs: number;
};
