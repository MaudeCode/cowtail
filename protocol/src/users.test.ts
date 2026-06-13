import { describe, expect, test } from "bun:test";

import { userDevicesResponseSchema } from "./users.js";

describe("user protocol schemas", () => {
  test("accepts device listings with token previews", () => {
    expect(
      userDevicesResponseSchema.parse({
        ok: true,
        userId: "user-1",
        count: 1,
        devices: [
          {
            id: "device-1",
            deviceTokenPreview: "abcdef...123456",
            platform: "ios",
            environment: "development",
            enabled: true,
            deviceName: "iPhone",
            lastSeenAt: 1,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    ).toEqual({
      ok: true,
      userId: "user-1",
      count: 1,
      devices: [
        {
          id: "device-1",
          deviceTokenPreview: "abcdef...123456",
          platform: "ios",
          environment: "development",
          enabled: true,
          deviceName: "iPhone",
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
  });

  test("rejects device listings with raw token only", () => {
    const result = userDevicesResponseSchema.safeParse({
      ok: true,
      userId: "user-1",
      count: 1,
      devices: [
        {
          deviceToken: "raw-token",
          platform: "ios",
          environment: "development",
          enabled: true,
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
