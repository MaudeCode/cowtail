import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { buildOptionalSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "openclaw/plugin-sdk/zod";

export const cowtailChannelConfigSchema = buildChannelConfigSchema(
  z
    .object({
      enabled: z.boolean().optional(),
      url: z.string().min(1).optional(),
      bridgeToken: buildOptionalSecretInputSchema(),
      agentId: z.literal("main").optional(),
      connectTimeoutMs: z.number().int().positive().max(60_000).optional(),
      reconnectMinDelayMs: z.number().int().positive().max(60_000).optional(),
      reconnectMaxDelayMs: z.number().int().positive().max(300_000).optional(),
    })
    .passthrough(),
);
