import { describe, expect, test } from "vitest";

import {
  evaluateSessionByIdValidation,
  evaluateSessionTokenHashVerification,
  SESSION_TTL_MS,
  verifyRealtimeConvexToken,
} from "./authSessions";

describe("auth session helpers", () => {
  test("authorizes matching realtime Convex service tokens", () => {
    expect(
      verifyRealtimeConvexToken({
        providedToken: "service-token",
        expectedToken: "service-token",
      }),
    ).toBe(true);
  });

  test("rejects missing or mismatched realtime Convex service tokens", () => {
    expect(
      verifyRealtimeConvexToken({
        providedToken: "",
        expectedToken: "service-token",
      }),
    ).toBe(false);
    expect(
      verifyRealtimeConvexToken({
        providedToken: "service-token",
        expectedToken: "",
      }),
    ).toBe(false);
    expect(
      verifyRealtimeConvexToken({
        providedToken: "service-token",
        expectedToken: "different-service-token",
      }),
    ).toBe(false);
  });

  test("rejects missing, revoked, and expired sessions", () => {
    expect(evaluateSessionTokenHashVerification(null, 100)).toEqual({
      result: { ok: false },
    });
    expect(
      evaluateSessionTokenHashVerification(
        {
          _id: "session-1",
          userId: "user-1",
          expiresAt: 200,
          revokedAt: 90,
        },
        100,
      ),
    ).toEqual({
      result: { ok: false },
    });
    expect(
      evaluateSessionTokenHashVerification(
        {
          _id: "session-1",
          userId: "user-1",
          expiresAt: 100,
        },
        100,
      ),
    ).toEqual({
      result: { ok: false },
    });
  });

  test("accepts valid sessions and slides their expiry from this use", () => {
    expect(
      evaluateSessionTokenHashVerification(
        {
          _id: "session-1",
          userId: "user-1",
          expiresAt: 200,
        },
        100,
      ),
    ).toEqual({
      result: {
        ok: true,
        sessionId: "session-1",
        userId: "user-1",
        expiresAt: 100 + SESSION_TTL_MS,
      },
      sessionId: "session-1",
      patch: { lastUsedAt: 100, expiresAt: 100 + SESSION_TTL_MS },
    });
  });

  test("validates sessions by id for realtime command rechecks", () => {
    expect(evaluateSessionByIdValidation(null, 100)).toEqual({ ok: false });
    expect(
      evaluateSessionByIdValidation(
        {
          _id: "session-1",
          userId: "user-1",
          expiresAt: 200,
          revokedAt: 90,
        },
        100,
      ),
    ).toEqual({ ok: false });
    expect(
      evaluateSessionByIdValidation(
        {
          _id: "session-1",
          userId: "user-1",
          expiresAt: 100,
        },
        100,
      ),
    ).toEqual({ ok: false });
    expect(
      evaluateSessionByIdValidation(
        {
          _id: "session-1",
          userId: "user-1",
          expiresAt: 200,
        },
        100,
      ),
    ).toEqual({ ok: true, userId: "user-1", expiresAt: 200 });
  });
});
