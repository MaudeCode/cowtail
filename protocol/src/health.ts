import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.js";

export const clusterNodeStatuses = ["Ready", "NotReady", "Unknown"] as const;
export const cephHealthStatuses = ["HEALTH_OK", "HEALTH_WARN", "HEALTH_ERR"] as const;

export const clusterNodeStatusSchema = z.enum(clusterNodeStatuses);
export const cephHealthStatusSchema = z.enum(cephHealthStatuses);

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
});

export type ClusterNodeStatus = z.infer<typeof clusterNodeStatusSchema>;
export type CephHealthStatus = z.infer<typeof cephHealthStatusSchema>;
export type HealthNode = z.infer<typeof healthNodeSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
