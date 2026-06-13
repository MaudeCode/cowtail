import { describe, expect, test } from "bun:test";

import { buildApnsPayload } from "./pushActions";

describe("APNS payload construction", () => {
  test("does not let custom data override server-owned aps fields", () => {
    const payload = JSON.parse(
      buildApnsPayload({
        deviceToken: "device-token",
        title: "Cowtail",
        body: "OpenClaw replied",
        data: {
          aps: {
            contentAvailable: 1,
          },
          threadId: "thread-1",
        },
      }),
    );

    expect(payload).toEqual({
      threadId: "thread-1",
      aps: {
        alert: {
          title: "Cowtail",
          body: "OpenClaw replied",
        },
        sound: "default",
      },
    });
  });
});
