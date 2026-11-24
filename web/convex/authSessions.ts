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

export const revokeSession = internalMutation({
  args: {
    id: v.id("authSessions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { revokedAt: Date.now() });
  },
});

export const OIDC_LOGIN_TTL_MS = 10 * 60 * 1000;
export const OIDC_HANDOFF_TTL_MS = 60 * 1000;

const oidcClientValidator = v.union(v.literal("web"), v.literal("ios"));

// Admission control for the unauthenticated start route. A single owner never has many
// logins in flight, so at most 20 unexpired rows exist, about 120 an hour: within what the
// hourly cleanup deletes.
export const OIDC_PENDING_LOGIN_LIMIT = 20;

export const createOidcLogin = internalMutation({
  args: {
    stateHash: v.string(),
    codeVerifier: v.string(),
    nonce: v.string(),
    client: oidcClientValidator,
    handoffChallenge: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("oidcLogins")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", now))
      .take(OIDC_PENDING_LOGIN_LIMIT);
    if (pending.length >= OIDC_PENDING_LOGIN_LIMIT) {
      return { admitted: false };
    }

    await ctx.db.insert("oidcLogins", { ...args, expiresAt: now + OIDC_LOGIN_TTL_MS });
    return { admitted: true };
  },
});

// The callback's single use of a state: an unknown, expired or already consumed state
// returns null, and a live one is marked consumed in the same transaction.
export const consumeOidcLoginByState = internalMutation({
  args: {
    stateHash: v.string(),
  },
  handler: async (ctx, args) => {
    const login = await ctx.db
      .query("oidcLogins")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    const now = Date.now();
    if (!login || login.consumedAt !== undefined || login.expiresAt <= now) {
      return null;
    }

    await ctx.db.patch(login._id, { consumedAt: now });
    return {
      id: login._id,
      codeVerifier: login.codeVerifier,
      nonce: login.nonce,
      client: login.client,
    };
  },
});

export const storeOidcHandoffCode = internalMutation({
  args: {
    id: v.id("oidcLogins"),
    handoffCodeHash: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      handoffCodeHash: args.handoffCodeHash,
      expiresAt: Date.now() + OIDC_HANDOFF_TTL_MS,
    });
  },
});

// Any redemption attempt burns the code, so a wrong verifier cannot be retried.
export const redeemOidcHandoffCode = internalMutation({
  args: {
    handoffCodeHash: v.string(),
    handoffChallenge: v.string(),
  },
  handler: async (ctx, args) => {
    const login = await ctx.db
      .query("oidcLogins")
      .withIndex("by_handoffCodeHash", (q) => q.eq("handoffCodeHash", args.handoffCodeHash))
      .unique();
    if (!login) {
      return { ok: false as const };
    }

    await ctx.db.delete(login._id);
    return {
      ok:
        login.client === "ios" &&
        login.expiresAt > Date.now() &&
        login.handoffChallenge === args.handoffChallenge,
    };
  },
});

export const deleteExpiredOidcLogins = internalMutation({
  args: {},
  handler: async (ctx) => {
    // ponytail: 500 rows per hourly run; a backlog drains over later runs.
    const expired = await ctx.db
      .query("oidcLogins")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(500);
    for (const login of expired) {
      await ctx.db.delete(login._id);
    }
  },
});
