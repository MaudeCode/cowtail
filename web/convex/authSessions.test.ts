import { describe, expect, test } from "bun:test";

import { evaluateSessionTokenHashVerification } from "./authSessions";

describe("auth session helpers", () => {
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

  test("accepts valid sessions and returns the lastUsedAt touch patch", () => {
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
      result: { ok: true, userId: "user-1", expiresAt: 200 },
      sessionId: "session-1",
      patch: { lastUsedAt: 100 },
    });
  });
});
