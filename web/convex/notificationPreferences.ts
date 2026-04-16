import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const DIGEST_CLAIM_TTL_MS = 15 * 60 * 1000;

export const getByUserId = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const getEffectiveForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    return {
      userId: args.userId,
      dailyDigestEnabled: existing?.dailyDigestEnabled ?? false,
      lastDigestKeySent: existing?.lastDigestKeySent,
      inFlightDigestKey: existing?.inFlightDigestKey,
      inFlightDigestClaimedAt: existing?.inFlightDigestClaimedAt,
      createdAt: existing?.createdAt,
      updatedAt: existing?.updatedAt,
    };
  },
});

export const listUsersWithDailyDigestEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const preferences = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_dailyDigestEnabled", (q) => q.eq("dailyDigestEnabled", true))
      .collect();

    return preferences
      .map((preference) => ({
        userId: preference.userId,
        lastDigestKeySent: preference.lastDigestKeySent,
        inFlightDigestKey: preference.inFlightDigestKey,
        inFlightDigestClaimedAt: preference.inFlightDigestClaimedAt,
      }))
      .sort((left, right) => left.userId.localeCompare(right.userId));
  },
});

export const upsertForUser = internalMutation({
  args: {
    userId: v.string(),
    dailyDigestEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        dailyDigestEnabled: args.dailyDigestEnabled,
        updatedAt: now,
      });

      return {
        id: existing._id,
        created: false,
      };
    }

    const id = await ctx.db.insert("userNotificationPreferences", {
      userId: args.userId,
      dailyDigestEnabled: args.dailyDigestEnabled,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      created: true,
    };
  },
});

export const markLastDigestKeySent = internalMutation({
  args: {
    userId: v.string(),
    lastDigestKeySent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastDigestKeySent: args.lastDigestKeySent,
        inFlightDigestKey: undefined,
        inFlightDigestClaimedAt: undefined,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("userNotificationPreferences", {
      userId: args.userId,
      dailyDigestEnabled: false,
      lastDigestKeySent: args.lastDigestKeySent,
      inFlightDigestKey: undefined,
      inFlightDigestClaimedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimDigestKey = internalMutation({
  args: {
    userId: v.string(),
    digestKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();

    if (!existing || !existing.dailyDigestEnabled) {
      return { claimed: false };
    }

    if (existing.lastDigestKeySent === args.digestKey) {
      return { claimed: false };
    }

    if (
      existing.inFlightDigestKey &&
      existing.inFlightDigestKey !== args.digestKey &&
      existing.inFlightDigestClaimedAt &&
      now - existing.inFlightDigestClaimedAt < DIGEST_CLAIM_TTL_MS
    ) {
      return { claimed: false };
    }

    if (
      existing.inFlightDigestKey === args.digestKey &&
      existing.inFlightDigestClaimedAt &&
      now - existing.inFlightDigestClaimedAt < DIGEST_CLAIM_TTL_MS
    ) {
      return { claimed: false };
    }

    await ctx.db.patch(existing._id, {
      inFlightDigestKey: args.digestKey,
      inFlightDigestClaimedAt: now,
      updatedAt: now,
    });

    return { claimed: true };
  },
});

export const releaseDigestKeyClaim = internalMutation({
  args: {
    userId: v.string(),
    digestKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!existing || existing.inFlightDigestKey !== args.digestKey) {
      return;
    }

    await ctx.db.patch(existing._id, {
      inFlightDigestKey: undefined,
      inFlightDigestClaimedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});
