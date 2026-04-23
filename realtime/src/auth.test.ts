import { describe, expect, test } from "bun:test";

import { authenticateClientHello } from "./auth";

describe("authenticateClientHello", () => {
  test("accepts OpenClaw plugin hello with correct bridge token and preserves lastSeenSequence", async () => {
    expect(
      await authenticateClientHello(
        {
          protocolVersion: 1,
          clientKind: "openclaw_plugin",
          token: "bridge-token",
          lastSeenSequence: 42,
        },
        {
          bridgeToken: "bridge-token",
          verifyAppSessionToken: async () => ({ ok: false }),
        },
      ),
    ).toEqual({
      ok: true,
      client: {
        kind: "openclaw_plugin",
        lastSeenSequence: 42,
      },
    });
  });

  test('rejects OpenClaw plugin hello with wrong token as { ok: false, reason: "unauthorized" }', async () => {
    expect(
      await authenticateClientHello(
        {
          protocolVersion: 1,
          clientKind: "openclaw_plugin",
          token: "wrong-token",
        },
        {
          bridgeToken: "bridge-token",
          verifyAppSessionToken: async () => ({ ok: false }),
        },
      ),
    ).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  test('malformed hello returns { ok: false, reason: "invalid_hello" } and does not call the iOS verifier', async () => {
    let verifierCalls = 0;

    expect(
      await authenticateClientHello(
        {
          protocolVersion: 1,
          clientKind: "ios",
        },
        {
          bridgeToken: "bridge-token",
          verifyAppSessionToken: async () => {
            verifierCalls += 1;
            return { ok: false };
          },
        },
      ),
    ).toEqual({
      ok: false,
      reason: "invalid_hello",
    });

    expect(verifierCalls).toBe(0);
  });

  test('malformed OpenClaw plugin hello returns { ok: false, reason: "invalid_hello" } and does not call the iOS verifier', async () => {
    let verifierCalls = 0;

    expect(
      await authenticateClientHello(
        {
          protocolVersion: 1,
          clientKind: "openclaw_plugin",
        },
        {
          bridgeToken: "bridge-token",
          verifyAppSessionToken: async () => {
            verifierCalls += 1;
            return { ok: false };
          },
        },
      ),
    ).toEqual({
      ok: false,
      reason: "invalid_hello",
    });

    expect(verifierCalls).toBe(0);
  });

  test('iOS verifier failure returns { ok: false, reason: "unauthorized" }', async () => {
    let verifiedToken: string | undefined;

    expect(
      await authenticateClientHello(
        {
          protocolVersion: 1,
          clientKind: "ios",
          appSessionToken: "session-token",
        },
        {
          bridgeToken: "bridge-token",
          verifyAppSessionToken: async (token) => {
            verifiedToken = token;
            return { ok: false };
          },
        },
      ),
    ).toEqual({
      ok: false,
      reason: "unauthorized",
    });

    expect(verifiedToken).toBe("session-token");
  });

  test('accepts iOS hello only after app-session verification, passes the token to the verifier, returns { kind: "ios", userId, sessionId, expiresAt, lastSeenSequence }', async () => {
    let verifiedToken: string | undefined;

    expect(
      await authenticateClientHello(
        {
          protocolVersion: 1,
          clientKind: "ios",
          appSessionToken: "session-token",
          lastSeenSequence: 9,
        },
        {
          bridgeToken: "bridge-token",
          verifyAppSessionToken: async (token) => {
            verifiedToken = token;
            return {
              ok: true,
              userId: "user-123",
              sessionId: "session-123",
              expiresAt: 200,
            };
          },
        },
      ),
    ).toEqual({
      ok: true,
      client: {
        kind: "ios",
        userId: "user-123",
        sessionId: "session-123",
        expiresAt: 200,
        lastSeenSequence: 9,
      },
    });

    expect(verifiedToken).toBe("session-token");
  });
});
