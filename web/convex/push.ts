import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function getDeviceRegistrationByToken(ctx: MutationCtx | QueryCtx, deviceToken: string) {
  return await ctx.db
    .query("deviceRegistrations")
    .withIndex("by_deviceToken", (q) => q.eq("deviceToken", deviceToken))
    .unique();
}

async function disableDeviceRegistration(ctx: MutationCtx, deviceToken: string) {
  const existing = await getDeviceRegistrationByToken(ctx, deviceToken);

  if (!existing) {
    return { ok: true, updated: false };
  }

  await ctx.db.patch(existing._id, {
    enabled: false,
    updatedAt: Date.now(),
  });

  return { ok: true, updated: true };
}

async function listEnabledDevices(ctx: MutationCtx | QueryCtx, userId: string) {
  return await ctx.db
    .query("deviceRegistrations")
    .withIndex("by_userId_enabled", (q) => q.eq("userId", userId).eq("enabled", true))
    .collect();
}

async function listCurrentUsersSummary(ctx: QueryCtx) {
  const registrations = await ctx.db
    .query("deviceRegistrations")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .collect();

  const enabledDeviceCounts = new Map<string, number>();

  for (const registration of registrations) {
    enabledDeviceCounts.set(
      registration.userId,
      (enabledDeviceCounts.get(registration.userId) ?? 0) + 1,
    );
  }

  return Array.from(enabledDeviceCounts.entries())
    .map(([userId, enabledDeviceCount]) => ({
      userId,
      enabledDeviceCount,
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

export const upsertDeviceRegistration = mutation({
  args: {
    userId: v.string(),
    deviceToken: v.string(),
    platform: v.string(),
    environment: v.string(),
    enabled: v.boolean(),
    deviceName: v.optional(v.string()),
    lastSeenAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getDeviceRegistrationByToken(ctx, args.deviceToken);

    const document = {
      ...args,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, document);
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("deviceRegistrations", document);
    return { id, created: true };
  },
});

export const disableDeviceRegistrationByToken = mutation({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    return await disableDeviceRegistration(ctx, args.deviceToken);
  },
});

export const disableDeviceRegistrationByTokenInternal = internalMutation({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    return await disableDeviceRegistration(ctx, args.deviceToken);
  },
});

export const listEnabledDevicesForUser = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await listEnabledDevices(ctx, args.userId);
  },
});

export const listCurrentUsers = query({
  args: {},
  handler: async (ctx) => {
    return await listCurrentUsersSummary(ctx);
  },
});

export const listEnabledDevicesForUserInternal = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await listEnabledDevices(ctx, args.userId);
  },
});
