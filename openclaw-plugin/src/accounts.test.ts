import { describe, expect, test } from "bun:test";
import { resolveCowtailAccount, listCowtailAccountIds } from "./accounts.js";

describe("Cowtail account resolution", () => {
  test("uses configured url and bridge token", () => {
    const account = resolveCowtailAccount({
      channels: {
        cowtail: {
          enabled: true,
          url: "wss://cowtail.example.invalid/openclaw/realtime",
          bridgeToken: "bridge-token",
        },
      },
    });

    expect(account.configured).toBe(true);
    expect(account.enabled).toBe(true);
    expect(account.url).toBe("wss://cowtail.example.invalid/openclaw/realtime");
    expect(account.bridgeToken).toBe("bridge-token");
    expect(account.agentId).toBe("main");
  });

  test("falls back to OPENCLAW_COWTAIL_BRIDGE_TOKEN for default account", () => {
    const previous = process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN;
    process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN = "env-token";
    try {
      const account = resolveCowtailAccount({
        channels: {
          cowtail: {
            url: "wss://cowtail.example.invalid/openclaw/realtime",
          },
        },
      });
      expect(account.bridgeToken).toBe("env-token");
      expect(account.bridgeTokenSource).toBe("env");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN;
      } else {
        process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN = previous;
      }
    }
  });

  test("rejects non-default agent ids in v1", () => {
    expect(() =>
      resolveCowtailAccount({
        channels: {
          cowtail: {
            url: "wss://cowtail.example.invalid/openclaw/realtime",
            bridgeToken: "bridge-token",
            agentId: "ops",
          },
        },
      }),
    ).toThrow(/only supports agentId \"main\"/);
  });

  test("lists only the default account when configured", () => {
    expect(
      listCowtailAccountIds({
        channels: {
          cowtail: {
            url: "wss://cowtail.example.invalid/openclaw/realtime",
            bridgeToken: "bridge-token",
          },
        },
      }),
    ).toEqual(["default"]);
  });

  test("lists the default account for an unresolved SecretRef without throwing", () => {
    expect(
      listCowtailAccountIds({
        channels: {
          cowtail: {
            bridgeToken: {
              source: "env",
              provider: "default",
              id: "OPENCLAW_COWTAIL_BRIDGE_TOKEN",
            },
          },
        },
      }),
    ).toEqual(["default"]);
  });

  test("throws for an unresolved SecretRef in runtime resolution", () => {
    const previous = process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN;
    delete process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN;
    try {
      expect(() =>
        resolveCowtailAccount({
          channels: {
            cowtail: {
              url: "wss://cowtail.example.invalid/openclaw/realtime",
              bridgeToken: {
                source: "env",
                provider: "default",
                id: "OPENCLAW_COWTAIL_BRIDGE_TOKEN",
              },
            },
          },
        }),
      ).toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN;
      } else {
        process.env.OPENCLAW_COWTAIL_BRIDGE_TOKEN = previous;
      }
    }
  });
});
