import { afterEach, describe, expect, test } from "bun:test";

import { sendPushToUser } from "./pushDelivery";

describe("push delivery", () => {
  const originalApnsEnv = process.env.APNS_ENV;

  afterEach(() => {
    if (originalApnsEnv === undefined) {
      delete process.env.APNS_ENV;
      return;
    }

    process.env.APNS_ENV = originalApnsEnv;
  });

  test("sends only through the active APNS environment", async () => {
    process.env.APNS_ENV = "development";
    const actions: Array<Record<string, unknown>> = [];
    const mutations: Array<Record<string, unknown>> = [];
    const ctx = {
      runQuery: async () => [
        {
          deviceToken: "development-device-token-123456",
          environment: "development",
        },
        {
          deviceToken: "production-device-token-654321",
          environment: "production",
        },
      ],
      runAction: async (_action: unknown, args: Record<string, unknown>) => {
        actions.push(args);
        return { ok: false, reason: "BadDeviceToken" };
      },
      runMutation: async (_mutation: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    };

    await expect(
      sendPushToUser(ctx as never, {
        userId: "user-1",
        title: "Title",
        body: "Body",
      }),
    ).resolves.toEqual({
      ok: false,
      userId: "user-1",
      sent: 0,
      failed: 1,
      results: [
        {
          deviceToken: "develo...123456",
          environment: "development",
          ok: false,
          reason: "BadDeviceToken",
        },
        {
          deviceToken: "produc...654321",
          environment: "production",
          skipped: true,
          reason: "APNSEnvironmentMismatch",
          activeEnvironment: "development",
        },
      ],
    });

    expect(actions).toEqual([
      {
        deviceToken: "development-device-token-123456",
        title: "Title",
        body: "Body",
        data: undefined,
      },
    ]);
    expect(mutations).toEqual([
      {
        deviceToken: "development-device-token-123456",
      },
    ]);
  });
});
