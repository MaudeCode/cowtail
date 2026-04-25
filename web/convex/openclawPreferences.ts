import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const DEFAULT_OPENCLAW_DISPLAY_NAME = "OpenClaw";

function normalizeDisplayName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_OPENCLAW_DISPLAY_NAME;
}

export const getEffectiveForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userOpenClawPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    return {
      userId: args.userId,
      displayName: existing?.displayName ?? DEFAULT_OPENCLAW_DISPLAY_NAME,
      createdAt: existing?.createdAt,
      updatedAt: existing?.updatedAt,
    };
  },
});

export const upsertForUser = internalMutation({
  args: {
    userId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const displayName = normalizeDisplayName(args.displayName);
    const existing = await ctx.db
      .query("userOpenClawPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName,
        updatedAt: now,
      });

      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("userOpenClawPreferences", {
      userId: args.userId,
      displayName,
      createdAt: now,
      updatedAt: now,
    });

    return { id, created: true };
  },
});
