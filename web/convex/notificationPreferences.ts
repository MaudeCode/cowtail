import type { NotificationPreferences } from "@maudecode/cowtail-protocol";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { itemUrgencyValidator, quietHoursValidator } from "./itemValidators";

const ROUNDUP_CLAIM_TTL_MS = 15 * 60 * 1000;

// The stored row with every owner setting at its default where the row has none.
export function effectivePreferences(
  row: Doc<"userNotificationPreferences"> | null,
): NotificationPreferences {
  return {
    dailyRoundupEnabled: row?.dailyRoundupEnabled ?? false,
    quietHours: row?.quietHours ?? null,
    urgencyOverrides: row?.urgencyOverrides ?? {},
    requireAuthForApprovals: row?.requireAuthForApprovals ?? false,
  };
}

export async function preferencesRow(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("userNotificationPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

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
    const existing = await preferencesRow(ctx, args.userId);

    return {
      userId: args.userId,
      ...effectivePreferences(existing),
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

// Writes the settings the update names and returns every setting as stored after it.
export const upsertForUser = internalMutation({
  args: {
    userId: v.string(),
    dailyRoundupEnabled: v.optional(v.boolean()),
    quietHours: v.optional(v.union(quietHoursValidator, v.null())),
    urgencyOverrides: v.optional(v.record(v.string(), itemUrgencyValidator)),
    requireAuthForApprovals: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, quietHours, ...update }) => {
    const existing = await preferencesRow(ctx, userId);
    const now = Date.now();
    // `null` clears quiet hours; a field left out keeps what is stored.
    const patch = {
      ...update,
      ...(quietHours === undefined ? {} : { quietHours: quietHours ?? undefined }),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("userNotificationPreferences", {
        userId,
        dailyRoundupEnabled: false,
        ...patch,
        createdAt: now,
      });
    }
    return effectivePreferences(await preferencesRow(ctx, userId));
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
