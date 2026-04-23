import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const REALTIME_CONVEX_TOKEN_ENV_VAR = "COWTAIL_REALTIME_CONVEX_TOKEN";

type StoredAuthSession = {
  _id: string;
  userId: string;
  expiresAt: number;
  revokedAt?: number;
};

export function verifyRealtimeConvexToken({
  providedToken,
  expectedToken,
}: {
  providedToken: string | undefined;
  expectedToken: string | undefined;
}): boolean {
  if (!providedToken || !expectedToken) {
    return false;
  }

  const providedBytes = new TextEncoder().encode(providedToken);
  const expectedBytes = new TextEncoder().encode(expectedToken);
  let difference = providedBytes.length ^ expectedBytes.length;
  const length = Math.max(providedBytes.length, expectedBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

export function requireRealtimeConvexToken(serviceToken: string): void {
  if (
    !verifyRealtimeConvexToken({
      providedToken: serviceToken,
      expectedToken: process.env[REALTIME_CONVEX_TOKEN_ENV_VAR]?.trim(),
    })
  ) {
    throw new Error("Unauthorized");
  }
}

export function evaluateSessionTokenHashVerification<SessionId extends string>(
  session: (StoredAuthSession & { _id: SessionId }) | null | undefined,
  now: number,
):
  | { result: { ok: false } }
  | {
      result: { ok: true; sessionId: string; userId: string; expiresAt: number };
      sessionId: SessionId;
      patch: { lastUsedAt: number };
    } {
  if (!session || session.revokedAt !== undefined || session.expiresAt <= now) {
    return { result: { ok: false } };
  }

  return {
    result: {
      ok: true,
      sessionId: String(session._id),
      userId: session.userId,
      expiresAt: session.expiresAt,
    },
    sessionId: session._id,
    patch: { lastUsedAt: now },
  };
}

export function evaluateSessionByIdValidation(
  session: StoredAuthSession | null | undefined,
  now: number,
): { ok: false } | { ok: true; userId: string; expiresAt: number } {
  if (!session || session.revokedAt !== undefined || session.expiresAt <= now) {
    return { ok: false };
  }

  return { ok: true, userId: session.userId, expiresAt: session.expiresAt };
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
    serviceToken: v.string(),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

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

export const validateSessionById = query({
  args: {
    serviceToken: v.string(),
    sessionId: v.id("authSessions"),
  },
  handler: async (ctx, args) => {
    requireRealtimeConvexToken(args.serviceToken);

    const session = await ctx.db.get(args.sessionId);
    return evaluateSessionByIdValidation(session, Date.now());
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
