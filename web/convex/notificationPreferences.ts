import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const ROUNDUP_CLAIM_TTL_MS = 15 * 60 * 1000;

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
      dailyRoundupEnabled: existing?.dailyRoundupEnabled ?? false,
      lastRoundupKeySent: existing?.lastRoundupKeySent,
      inFlightRoundupKey: existing?.inFlightRoundupKey,
      inFlightRoundupClaimedAt: existing?.inFlightRoundupClaimedAt,
      createdAt: existing?.createdAt,
      updatedAt: existing?.updatedAt,
    };
  },
});

export const listUsersWithDailyRoundupEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const preferences = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_dailyRoundupEnabled", (q) => q.eq("dailyRoundupEnabled", true))
      .collect();

    return preferences
      .map((preference) => ({
        userId: preference.userId,
        lastRoundupKeySent: preference.lastRoundupKeySent,
        inFlightRoundupKey: preference.inFlightRoundupKey,
        inFlightRoundupClaimedAt: preference.inFlightRoundupClaimedAt,
      }))
      .sort((left, right) => left.userId.localeCompare(right.userId));
  },
});

export const upsertForUser = internalMutation({
  args: {
    userId: v.string(),
    dailyRoundupEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        dailyRoundupEnabled: args.dailyRoundupEnabled,
        updatedAt: now,
      });

      return {
        id: existing._id,
        created: false,
      };
    }

    const id = await ctx.db.insert("userNotificationPreferences", {
      userId: args.userId,
      dailyRoundupEnabled: args.dailyRoundupEnabled,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      created: true,
    };
  },
});

export const markLastRoundupKeySent = internalMutation({
  args: {
    userId: v.string(),
    lastRoundupKeySent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastRoundupKeySent: args.lastRoundupKeySent,
        inFlightRoundupKey: undefined,
        inFlightRoundupClaimedAt: undefined,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("userNotificationPreferences", {
      userId: args.userId,
      dailyRoundupEnabled: false,
      lastRoundupKeySent: args.lastRoundupKeySent,
      inFlightRoundupKey: undefined,
      inFlightRoundupClaimedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimRoundupKey = internalMutation({
  args: {
    userId: v.string(),
    roundupKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();

    if (!existing || !existing.dailyRoundupEnabled) {
      return { claimed: false };
    }

    if (existing.lastRoundupKeySent === args.roundupKey) {
      return { claimed: false };
    }

    if (
      existing.inFlightRoundupKey &&
      existing.inFlightRoundupKey !== args.roundupKey &&
      existing.inFlightRoundupClaimedAt &&
      now - existing.inFlightRoundupClaimedAt < ROUNDUP_CLAIM_TTL_MS
    ) {
      return { claimed: false };
    }

    if (
      existing.inFlightRoundupKey === args.roundupKey &&
      existing.inFlightRoundupClaimedAt &&
      now - existing.inFlightRoundupClaimedAt < ROUNDUP_CLAIM_TTL_MS
    ) {
      return { claimed: false };
    }

    await ctx.db.patch(existing._id, {
      inFlightRoundupKey: args.roundupKey,
      inFlightRoundupClaimedAt: now,
      updatedAt: now,
    });

    return { claimed: true };
  },
});

export const releaseRoundupKeyClaim = internalMutation({
  args: {
    userId: v.string(),
    roundupKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!existing || existing.inFlightRoundupKey !== args.roundupKey) {
      return;
    }

    await ctx.db.patch(existing._id, {
      inFlightRoundupKey: undefined,
      inFlightRoundupClaimedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});
