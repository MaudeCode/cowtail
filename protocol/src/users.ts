import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.js";

export const usersListEntrySchema = z.object({
  userId: nonEmptyStringSchema,
  enabledDeviceCount: z.number().int().nonnegative(),
});

export const usersListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  users: z.array(usersListEntrySchema),
});

export type UsersListEntry = z.infer<typeof usersListEntrySchema>;
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;
