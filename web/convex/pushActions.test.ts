import { itemKinds, type ItemKind } from "@maudecode/cowtail-protocol";
import { describe, expect, test } from "vitest";

import type { Id } from "./_generated/dataModel";
import { itemPush } from "./itemDelivery";
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

describe("item push payloads", () => {
  const categories: Record<ItemKind, string> = {
    approval: "ITEM_APPROVAL",
    question: "ITEM_QUESTION",
    alert: "ITEM_ACK",
    failure: "ITEM_ACK",
    fyi: "ITEM_ACK",
    done: "ITEM_ACK",
  };
  const levels = { now: "time-sensitive", today: "active" } as const;

  const item = (kind: ItemKind, urgency: "now" | "today", dedupeKey?: string) => ({
    _id: "item-1" as Id<"items">,
    kind,
    urgency,
    title: "Restart ingress in edge?",
    body: "kubectl rollout restart deploy/ingress -n edge",
    dedupeKey,
  });
  const payload = (pushed: ReturnType<typeof itemPush>) =>
    JSON.parse(buildApnsPayload({ deviceToken: "device-token", ...pushed }));

  for (const kind of itemKinds) {
    for (const urgency of ["now", "today"] as const) {
      test(`a ${urgency} ${kind} item`, () => {
        expect(payload(itemPush(item(kind, urgency, "ingress:edge"), 3))).toEqual({
          itemId: "item-1",
          aps: {
            alert: {
              title: "Restart ingress in edge?",
              body: "kubectl rollout restart deploy/ingress -n edge",
            },
            sound: "default",
            "interruption-level": levels[urgency],
            "thread-id": "ingress:edge",
            badge: 3,
            category: categories[kind],
          },
        });
      });
    }
  }

  test("an item without a dedupeKey threads by its id, and an alert item names its alert", () => {
    const pushed = payload(
      itemPush({ ...item("alert", "now"), alertId: "alert-1" as Id<"alerts"> }, 0),
    );
    expect(pushed).toMatchObject({
      itemId: "item-1",
      alertId: "alert-1",
      aps: { "thread-id": "item-1", badge: 0 },
    });
  });
});
