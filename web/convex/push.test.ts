import { userDevicesResponseSchema } from "@maudecode/cowtail-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import { newBackend, request, rows, seedSession } from "../test/convexHarness";
import { internal } from "./_generated/api";
import { disableDeviceRegistrationByToken } from "./push";

type ConvexFunctionForTest = {
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

// The Apple identity-token path without Apple's JWKS: a token names the user it verifies as.
vi.mock("./appleIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./appleIdentity")>()),
  verifyAppleIdentityToken: async (identityToken: string) => identityToken.replace("apple:", ""),
}));

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

describe("push device registration routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const DEVICE = "device-token-0123456789";

  async function deviceRows(t: ReturnType<typeof newBackend>) {
    return (await rows(t, "deviceRegistrations")).map(({ userId, deviceToken, enabled }) => ({
      userId,
      deviceToken,
      enabled,
    }));
  }

  test("a session bearer registers the device under the session's user", async () => {
    const t = newBackend();
    const bearer = await seedSession(t, "owner-user");

    const response = await request(t, "/api/push/register", {
      method: "POST",
      bearer,
      body: { deviceToken: DEVICE },
    });

    expect(response.status).toBe(200);
    expect(await deviceRows(t)).toEqual([
      { userId: "owner-user", deviceToken: DEVICE, enabled: true },
    ]);
  });

  test("a session bearer disables the session user's device", async () => {
    const t = newBackend();
    const bearer = await seedSession(t, "owner-user");
    await request(t, "/api/push/register", {
      method: "POST",
      bearer,
      body: { deviceToken: DEVICE },
    });

    const response = await request(t, "/api/push/unregister", {
      method: "POST",
      bearer,
      body: { deviceToken: DEVICE },
    });

    expect(response).toEqual({ status: 200, json: { ok: true, updated: true } });
    expect(await deviceRows(t)).toEqual([
      { userId: "owner-user", deviceToken: DEVICE, enabled: false },
    ]);
  });

  test("a request with neither a session nor an identity token is refused", async () => {
    const t = newBackend();

    for (const path of ["/api/push/register", "/api/push/unregister"]) {
      const response = await request(t, path, { method: "POST", body: { deviceToken: DEVICE } });
      expect(response.status).toBe(401);
    }
    expect(await deviceRows(t)).toEqual([]);
  });

  async function deliverableDevices(t: ReturnType<typeof newBackend>, userId: string) {
    const devices = await t.query(internal.push.listEnabledDevicesForUser, { userId });
    return devices.map((device) => device.deviceToken);
  }

  test("a device registered with a session stops receiving pushes once that session is revoked", async () => {
    const t = newBackend();
    const bearer = await seedSession(t, "owner-user");
    await request(t, "/api/push/register", {
      method: "POST",
      bearer,
      body: { deviceToken: DEVICE },
    });
    expect(await deliverableDevices(t, "owner-user")).toEqual([DEVICE]);

    const logout = await request(t, "/api/auth/logout", { method: "POST", bearer });

    expect(logout.status).toBe(200);
    expect(await deliverableDevices(t, "owner-user")).toEqual([]);
  });

  test("a device registered with a session stops receiving pushes once that session expires", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const t = newBackend();
    const bearer = await seedSession(t, "owner-user");
    await request(t, "/api/push/register", {
      method: "POST",
      bearer,
      body: { deviceToken: DEVICE },
    });
    expect(await deliverableDevices(t, "owner-user")).toEqual([DEVICE]);

    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000);

    expect(await deliverableDevices(t, "owner-user")).toEqual([]);
  });

  test("an Apple identity token still registers the device under the Apple user", async () => {
    const t = newBackend();

    const response = await request(t, "/api/push/register", {
      method: "POST",
      body: { identityToken: "apple:apple-user", deviceToken: DEVICE },
    });

    expect(response.status).toBe(200);
    expect(await deviceRows(t)).toEqual([
      { userId: "apple-user", deviceToken: DEVICE, enabled: true },
    ]);
  });
});
