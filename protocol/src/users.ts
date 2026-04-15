import { z } from "zod";

import { nonEmptyStringSchema } from "./shared.js";

export const usersListEntrySchema = z.object({
  userId: nonEmptyStringSchema,
  enabledDeviceCount: z.number().int().nonnegative(),
});

export const userDeviceSchema = z.object({
  deviceToken: nonEmptyStringSchema,
  platform: nonEmptyStringSchema,
  environment: nonEmptyStringSchema,
  enabled: z.boolean(),
  deviceName: nonEmptyStringSchema.optional(),
  lastSeenAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const usersListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  users: z.array(usersListEntrySchema),
});

export const userDevicesResponseSchema = z.object({
  ok: z.literal(true),
  userId: nonEmptyStringSchema,
  count: z.number().int().nonnegative(),
  devices: z.array(userDeviceSchema),
});

export type UsersListEntry = z.infer<typeof usersListEntrySchema>;
export type UserDevice = z.infer<typeof userDeviceSchema>;
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;
export type UserDevicesResponse = z.infer<typeof userDevicesResponseSchema>;
