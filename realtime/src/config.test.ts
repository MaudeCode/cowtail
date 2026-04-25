import { describe, expect, test } from "bun:test";

import { loadRealtimeConfig } from "./config";

describe("loadRealtimeConfig", () => {
  test("loads required realtime environment", () => {
    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "  bridge-token  ",
        CONVEX_URL: "  https://convex.example.invalid  ",
        COWTAIL_HTTP_BASE_URL: "  https://cowtail.example.invalid/  ",
        PUSH_API_BEARER_TOKEN: "  push-token  ",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "  owner-user-id  ",
        COWTAIL_REALTIME_CONVEX_TOKEN: "  realtime-convex-token  ",
        PORT: " 8787 ",
      }),
    ).toEqual({
      bridgeToken: "bridge-token",
      convexUrl: "https://convex.example.invalid",
      httpBaseUrl: "https://cowtail.example.invalid",
      pushBearerToken: "push-token",
      ownerUserId: "owner-user-id",
      realtimeConvexToken: "realtime-convex-token",
      port: 8787,
    });
  });

  test("uses a default port", () => {
    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        VITE_CONVEX_URL: "https://convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid/",
        PUSH_API_BEARER_TOKEN: "push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }).port,
    ).toBe(8787);
  });

  test("prefers CONVEX_URL and falls back to VITE_CONVEX_URL", () => {
    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        VITE_CONVEX_URL: "https://vite-convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
        PUSH_API_BEARER_TOKEN: "push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }).convexUrl,
    ).toBe("https://vite-convex.example.invalid");

    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        CONVEX_URL: "https://convex.example.invalid",
        VITE_CONVEX_URL: "https://vite-convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
        PUSH_API_BEARER_TOKEN: "push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }).convexUrl,
    ).toBe("https://convex.example.invalid");
  });

  test("strips trailing slashes from the http base URL", () => {
    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        CONVEX_URL: "https://convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid///",
        PUSH_API_BEARER_TOKEN: "push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }).httpBaseUrl,
    ).toBe("https://cowtail.example.invalid");
  });

  test("rejects an empty http base URL after normalization", () => {
    expect(() =>
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        CONVEX_URL: "https://convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "///",
        PUSH_API_BEARER_TOKEN: "push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }),
    ).toThrow("Invalid COWTAIL_HTTP_BASE_URL: must not be empty after normalization");
  });

  test("rejects missing required values", () => {
    expect(() =>
      loadRealtimeConfig({
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
      }),
    ).toThrow("Missing required env var: OPENCLAW_COWTAIL_BRIDGE_TOKEN");
  });

  test("requires the realtime Convex service token", () => {
    expect(() =>
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        CONVEX_URL: "https://convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
        PUSH_API_BEARER_TOKEN: "push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
      }),
    ).toThrow("Missing required env var: COWTAIL_REALTIME_CONVEX_TOKEN");
  });

  test("uses PUSH_API_BEARER_TOKEN before the legacy realtime-specific name", () => {
    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        CONVEX_URL: "https://convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
        PUSH_API_BEARER_TOKEN: "canonical-push-token",
        COWTAIL_PUSH_API_BEARER_TOKEN: "legacy-push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }).pushBearerToken,
    ).toBe("canonical-push-token");
  });

  test("falls back to the legacy realtime-specific push token during transition", () => {
    expect(
      loadRealtimeConfig({
        OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
        CONVEX_URL: "https://convex.example.invalid",
        COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
        COWTAIL_PUSH_API_BEARER_TOKEN: "legacy-push-token",
        COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
        COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
      }).pushBearerToken,
    ).toBe("legacy-push-token");
  });

  test("rejects invalid port values", () => {
    const baseEnv = {
      OPENCLAW_COWTAIL_BRIDGE_TOKEN: "bridge-token",
      CONVEX_URL: "https://convex.example.invalid",
      COWTAIL_HTTP_BASE_URL: "https://cowtail.example.invalid",
      PUSH_API_BEARER_TOKEN: "push-token",
      COWTAIL_OPENCLAW_OWNER_USER_ID: "owner-user-id",
      COWTAIL_REALTIME_CONVEX_TOKEN: "realtime-convex-token",
    };

    expect(() => loadRealtimeConfig({ ...baseEnv, PORT: "1e3" })).toThrow("Invalid PORT: 1e3");
    expect(() => loadRealtimeConfig({ ...baseEnv, PORT: "0x10" })).toThrow("Invalid PORT: 0x10");
    expect(() => loadRealtimeConfig({ ...baseEnv, PORT: "8080.5" })).toThrow(
      "Invalid PORT: 8080.5",
    );
    expect(() => loadRealtimeConfig({ ...baseEnv, PORT: "0" })).toThrow("Invalid PORT: 0");
  });
});
