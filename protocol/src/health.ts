import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.ts";

export const clusterNodeStatuses = ["Ready", "NotReady", "Unknown"] as const;
export const cephHealthStatuses = ["HEALTH_OK", "HEALTH_WARN", "HEALTH_ERR"] as const;

export const alertPipelineStates = ["ok", "silent", "not_configured"] as const;

export const clusterNodeStatusSchema = z.enum(clusterNodeStatuses);
export const cephHealthStatusSchema = z.enum(cephHealthStatuses);

export const alertPipelineStateSchema = z.enum(alertPipelineStates);

// Whether the Alertmanager Watchdog still reaches Cowtail. `not_configured` until the first one.
export const alertPipelineStatusSchema = z.object({
  state: alertPipelineStateSchema,
  lastWatchdogAt: z.number().finite().nonnegative().optional(),
});

export const healthNodeSchema = z.object({
  name: nonEmptyStringSchema,
  status: clusterNodeStatusSchema,
  cpu: z.number().finite().nonnegative(),
  memory: z.number().finite().nonnegative(),
});

export const healthResponseSchema = z.object({
  version: z.literal(1).optional(),
  nodes: z.array(healthNodeSchema),
  cephStatus: cephHealthStatusSchema,
  cephMessage: nonEmptyStringSchema,
  storageUsed: z.number().finite().nonnegative(),
  storageTotal: z.number().finite().nonnegative(),
  storageUnit: nonEmptyStringSchema,
  // How many of `nodes` are Ready. Optional so a client still decodes a server from before it.
  readyNodes: z.number().int().nonnegative().optional(),
  // Optional so a client still decodes a server from before it.
  alertPipeline: alertPipelineStatusSchema.optional(),
});

export type ClusterNodeStatus = z.infer<typeof clusterNodeStatusSchema>;
export type CephHealthStatus = z.infer<typeof cephHealthStatusSchema>;
export type AlertPipelineState = z.infer<typeof alertPipelineStateSchema>;
export type AlertPipelineStatus = z.infer<typeof alertPipelineStatusSchema>;
export type HealthNode = z.infer<typeof healthNodeSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
