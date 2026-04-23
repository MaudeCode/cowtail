import { v } from "convex/values";

import { internalMutation, internalQuery, mutation } from "./_generated/server";

type StoredAuthSession = {
  _id: string;
  userId: string;
  expiresAt: number;
  revokedAt?: number;
};

export function evaluateSessionTokenHashVerification<SessionId extends string>(
  session: (StoredAuthSession & { _id: SessionId }) | null | undefined,
  now: number,
):
  | { result: { ok: false } }
  | {
      result: { ok: true; userId: string; expiresAt: number };
      sessionId: SessionId;
      patch: { lastUsedAt: number };
    } {
  if (!session || session.revokedAt !== undefined || session.expiresAt <= now) {
    return { result: { ok: false } };
  }

  return {
    result: { ok: true, userId: session.userId, expiresAt: session.expiresAt },
    sessionId: session._id,
    patch: { lastUsedAt: now },
  };
}

export const getSessionByTokenHash = internalQuery({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
  },
});

export const verifySessionTokenHash = mutation({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    const now = Date.now();
    const verification = evaluateSessionTokenHashVerification(session, now);

    if (!("patch" in verification)) {
      return verification.result;
    }

    await ctx.db.patch(verification.sessionId, verification.patch);

    return verification.result;
  },
});

export const createSession = internalMutation({
  args: {
    userId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("authSessions", {
      userId: args.userId,
      tokenHash: args.tokenHash,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: args.expiresAt,
    });

    return { id };
  },
});

export const touchSession = internalMutation({
  args: {
    id: v.id("authSessions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lastUsedAt: Date.now(),
    });
  },
});

export const revokeSessionsForUser = internalMutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const revokedAt = Date.now();
    for (const session of sessions) {
      if (session.revokedAt) {
        continue;
      }

      await ctx.db.patch(session._id, { revokedAt });
    }
  },
});
