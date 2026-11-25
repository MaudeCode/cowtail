import XCTest
@testable import CowtailKit

final class DeliveredNotificationsTests: XCTestCase {
    func testNotificationsNameTheItemsTheirPushCarried() {
        let source: [String: Any] = ["slug": "cowtail", "displayName": "Cowtail"]
        let payloads: [[AnyHashable: Any]] = [
            ["itemId": "item-1", "source": source],
            ["type": "item_batch", "count": 2, "itemIds": ["item-2", "item-3"], "source": source],
            // A batch too large to list its items, and the roundup, name none.
            ["type": "item_batch", "count": 60, "source": source],
            ["type": "daily_roundup", "url": "https://cowtail.example.test/roundup"],
        ]

        XCTAssertEqual(
            payloads.map { DeliveredItemNotification(identifier: "push", userInfo: $0).itemIDs },
            [["item-1"], ["item-2", "item-3"], [], []]
        )
    }

    func testABatchNotificationStaysWhileAnyOfItsItemsIsLive() async {
        let center = FakeNotificationCenter(delivered: [
            DeliveredItemNotification(identifier: "batch-open", itemIDs: ["item-1", "item-2"]),
            DeliveredItemNotification(identifier: "batch-handled", itemIDs: ["item-3", "item-4"]),
        ])

        await DeliveredNotifications.show(badge: 0, liveItemIDs: ["item-2"], in: center)

        let remaining = await center.delivered.map(\.identifier)
        XCTAssertEqual(remaining, ["batch-open"])
    }

    func testABackgroundSyncSetsTheBadgeAndRemovesOnlyItsItemsNotifications() async throws {
        let userInfo: [AnyHashable: Any] = [
            "type": "item_sync",
            "badge": 2,
            "itemIds": ["item-1", "item-3"],
            "aps": ["content-available": 1],
        ]
        let center = FakeNotificationCenter(delivered: [
            DeliveredItemNotification(identifier: "handled", itemIDs: ["item-1"]),
            DeliveredItemNotification(identifier: "open", itemIDs: ["item-2"]),
            DeliveredItemNotification(identifier: "batch", itemIDs: ["item-3", "item-4"]),
        ])

        try await XCTUnwrap(ItemSyncPush(userInfo: userInfo)).apply(in: center)

        let badge = await center.badge
        let remaining = await center.delivered.map(\.identifier)
        XCTAssertEqual(badge, 2)
        XCTAssertEqual(remaining, ["open", "batch"])
        // An alert push for an item is no sync.
        XCTAssertNil(ItemSyncPush(userInfo: ["itemId": "item-1", "aps": ["badge": 1]]))
    }
}
