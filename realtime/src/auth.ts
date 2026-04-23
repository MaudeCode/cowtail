import { openclawClientHelloSchema } from "@maudecode/cowtail-protocol";
import type { OpenClawClientHello, OpenClawSequence } from "@maudecode/cowtail-protocol";

export type RealtimeClient =
  | {
      kind: "openclaw_plugin";
      lastSeenSequence?: OpenClawSequence;
    }
  | {
      kind: "ios";
      userId: string;
      lastSeenSequence?: OpenClawSequence;
    };

export type AppSessionVerificationResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
    };

export type AuthDeps = {
  bridgeToken: string;
  verifyAppSessionToken: (appSessionToken: string) => Promise<AppSessionVerificationResult>;
};

export type AuthResult =
  | {
      ok: true;
      client: RealtimeClient;
    }
  | {
      ok: false;
      reason: "invalid_hello" | "unauthorized";
    };

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);

  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function getLastSeenSequence(hello: OpenClawClientHello): OpenClawSequence | undefined {
  return hello.lastSeenSequence;
}

export async function authenticateClientHello(value: unknown, deps: AuthDeps): Promise<AuthResult> {
  const parsed = openclawClientHelloSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_hello",
    };
  }

  const hello = parsed.data;

  if (hello.clientKind === "openclaw_plugin") {
    if (!constantTimeEqual(hello.token, deps.bridgeToken)) {
      return {
        ok: false,
        reason: "unauthorized",
      };
    }

    return {
      ok: true,
      client: {
        kind: "openclaw_plugin",
        lastSeenSequence: getLastSeenSequence(hello),
      },
    };
  }

  const verification = await deps.verifyAppSessionToken(hello.appSessionToken);
  if (!verification.ok) {
    return {
      ok: false,
      reason: "unauthorized",
    };
  }

  return {
    ok: true,
    client: {
      kind: "ios",
      userId: verification.userId,
      lastSeenSequence: getLastSeenSequence(hello),
    },
  };
}
