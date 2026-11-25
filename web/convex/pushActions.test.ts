import { itemKinds, type ItemKind } from "@maudecode/cowtail-protocol";
import { describe, expect, test } from "vitest";

import type { Id } from "./_generated/dataModel";
import { batchPush, itemPush, itemSyncPush } from "./itemDelivery";
import { apnsDeliveryHeaders, buildApnsPayload } from "./pushActions";

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

describe("APNs delivery", () => {
  test("an alert goes as an alert at priority 10 unless the caller says otherwise", () => {
    expect(apnsDeliveryHeaders({})).toEqual({ "apns-push-type": "alert", "apns-priority": "10" });
    expect(apnsDeliveryHeaders({ pushType: "background", priority: 5 })).toEqual({
      "apns-push-type": "background",
      "apns-priority": "5",
    });
  });

  test("an item sync goes as a background push at priority 5 with the badge and item ids", () => {
    const sync = itemSyncPush(["item-1", "item-2"], 4);
    expect(apnsDeliveryHeaders(sync)).toEqual({
      "apns-push-type": "background",
      "apns-priority": "5",
    });
    expect(JSON.parse(buildApnsPayload({ deviceToken: "device-token", ...sync }))).toEqual({
      type: "item_sync",
      badge: 4,
      itemIds: ["item-1", "item-2"],
      aps: { "content-available": 1 },
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
  const hermes = { slug: "hermes", displayName: "Hermes" };
  const cowtail = { slug: "cowtail", displayName: "Cowtail" };

  const item = (kind: ItemKind, urgency: "now" | "today", dedupeKey?: string) => ({
    _id: "item-1" as Id<"items">,
    kind,
    urgency,
    title: "Restart ingress in edge?",
    body: "kubectl rollout restart deploy/ingress -n edge",
    dedupeKey,
    sourceInfo: hermes,
  });
  const payload = (pushed: ReturnType<typeof itemPush>) =>
    JSON.parse(buildApnsPayload({ deviceToken: "device-token", ...pushed }));

  for (const kind of itemKinds) {
    for (const urgency of ["now", "today"] as const) {
      test(`a ${urgency} ${kind} item`, () => {
        expect(payload(itemPush(item(kind, urgency, "ingress:edge"), 3))).toEqual({
          itemId: "item-1",
          source: hermes,
          aps: {
            alert: {
              title: "Restart ingress in edge?",
              body: "kubectl rollout restart deploy/ingress -n edge",
            },
            sound: "default",
            "mutable-content": 1,
            "interruption-level": levels[urgency],
            "thread-id": "ingress:edge",
            badge: 3,
            category: categories[kind],
          },
        });
      });
    }
  }

  test("an approval asks for Face ID on the lock screen while the owner requires it", () => {
    const protectedApproval = { ...item("approval", "now"), approvalNeedsAuth: true };
    const protectedAlert = { ...item("alert", "now"), approvalNeedsAuth: true };

    expect(payload(itemPush(protectedApproval, 0)).aps.category).toBe("ITEM_APPROVAL_AUTH");
    expect(payload(itemPush(protectedAlert, 0)).aps.category).toBe("ITEM_ACK");
  });

  test("a push for the longest item a producer may send stays inside APNs' 4 KB", () => {
    const source = {
      slug: "s".repeat(32),
      displayName: "Ä".repeat(40),
      iconUrl: `https://cowtail.example.com/actions/api/sources/${"s".repeat(32)}/icon`,
    };
    const longest = {
      ...item("question", "now", "k".repeat(500)),
      title: "Ä".repeat(500),
      body: "🐄".repeat(20_000),
      sourceInfo: source,
    };
    for (const pushed of [
      itemPush(longest, 99),
      batchPush([longest, longest, longest], 99, source),
    ]) {
      const bytes = Buffer.byteLength(buildApnsPayload({ deviceToken: "device-token", ...pushed }));
      expect(bytes).toBeLessThanOrEqual(4096);
      expect(pushed.body).toContain("…");
    }
  });

  test("a batch lists its item ids while they fit, and stays inside APNs' 4 KB", () => {
    const longest = {
      ...item("fyi", "today"),
      title: "Ä".repeat(500),
      sourceInfo: { slug: "s".repeat(32), displayName: "Ä".repeat(40) },
    };
    // Convex ids are 32 characters.
    const batch = (size: number) =>
      Array.from({ length: size }, (_, n) => ({
        ...longest,
        _id: String(n).padStart(32, "j") as Id<"items">,
      }));

    const fits = batchPush(batch(42), 7, longest.sourceInfo);
    expect(fits.data).toMatchObject({ type: "item_batch", count: 42 });
    expect((fits.data as { itemIds?: string[] }).itemIds).toHaveLength(42);
    const bytes = Buffer.byteLength(buildApnsPayload({ deviceToken: "device-token", ...fits }));
    expect(bytes).toBeLessThanOrEqual(4096);
    expect(batchPush(batch(43), 7, longest.sourceInfo).data).not.toHaveProperty("itemIds");
  });

  test("a push names its source, with the icon URL only when the source has an icon", () => {
    const iconUrl = "https://cowtail.example.com/actions/api/sources/deployer/icon";
    const deployer = { slug: "deployer", displayName: "Mac deployer", iconUrl };
    expect(payload(itemPush({ ...item("done", "now"), sourceInfo: deployer }, 0))).toMatchObject({
      source: { slug: "deployer", displayName: "Mac deployer", iconUrl },
      aps: { "mutable-content": 1 },
    });
    expect(payload(itemPush(item("done", "now"), 0)).source).toEqual(hermes);

    const two = [item("fyi", "today"), { ...item("fyi", "today"), sourceInfo: deployer }];
    expect(payload(batchPush(two, 1, cowtail))).toMatchObject({
      type: "item_batch",
      source: cowtail,
      aps: { "mutable-content": 1 },
    });
  });

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
