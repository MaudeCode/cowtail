import { userDevicesResponseSchema } from "@maudecode/cowtail-protocol";
import { describe, expect, test } from "vitest";

import { newBackend, request, seedSession } from "../test/convexHarness";
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

describe("the signed-in account's devices", () => {
  test("lists only the session user's enabled devices", async () => {
    const t = newBackend();
    const bearer = await seedSession(t, "owner-user");
    await t.run(async (ctx) => {
      const device = (userId: string, deviceName: string, enabled = true) =>
        ctx.db.insert("deviceRegistrations", {
          userId,
          deviceToken: `${deviceName}-token-0123456789`,
          platform: "ios",
          environment: "production",
          enabled,
          deviceName,
          lastSeenAt: 10,
          createdAt: 1,
          updatedAt: 10,
        });
      await device("owner-user", "iPhone");
      await device("owner-user", "Old iPad", false);
      await device("someone-else", "Their iPhone");
    });

    const response = await request(t, "/api/me/devices", { bearer });
    const anonymous = await request(t, "/api/me/devices");

    expect(response.status).toBe(200);
    const { devices } = userDevicesResponseSchema.parse(response.json);
    expect(devices.map((device) => [device.deviceName, device.lastSeenAt])).toEqual([
      ["iPhone", 10],
    ]);
    expect(anonymous.status).toBe(401);
  });
});
