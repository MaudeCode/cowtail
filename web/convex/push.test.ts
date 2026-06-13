import { describe, expect, test } from "bun:test";

import { disableDeviceRegistrationByToken } from "./push";

type ConvexFunctionForTest = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

function convexHandler(fn: unknown) {
  return (fn as ConvexFunctionForTest)._handler;
}

function createPushMutationCtx(existingDevice?: Record<string, unknown>) {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: (_table: string) => ({
        withIndex: () => ({
          unique: async () => existingDevice ?? null,
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  };

  return { ctx, patches };
}

describe("push registration mutations", () => {
  test("disableDeviceRegistrationByToken disables only owner tokens", async () => {
    const { ctx, patches } = createPushMutationCtx({
      _id: "device-1",
      userId: "owner-user",
      deviceToken: "device-token",
      enabled: true,
    });

    await expect(
      convexHandler(disableDeviceRegistrationByToken)(ctx, {
        userId: "other-user",
        deviceToken: "device-token",
      }),
    ).resolves.toEqual({ ok: true, updated: false });
    expect(patches).toEqual([]);

    await expect(
      convexHandler(disableDeviceRegistrationByToken)(ctx, {
        userId: "owner-user",
        deviceToken: "device-token",
      }),
    ).resolves.toEqual({ ok: true, updated: true });
    expect(patches).toEqual([
      {
        id: "device-1",
        value: {
          enabled: false,
          updatedAt: expect.any(Number),
        },
      },
    ]);
  });
});
