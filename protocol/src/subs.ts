import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.js";

export const subsListEntrySchema = z.object({
  userId: nonEmptyStringSchema,
  enabledDeviceCount: z.number().int().nonnegative(),
});

export const subsListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  subs: z.array(subsListEntrySchema),
});

export type SubsListEntry = z.infer<typeof subsListEntrySchema>;
export type SubsListResponse = z.infer<typeof subsListResponseSchema>;
