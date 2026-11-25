@testable import CowtailKit

/// Records what the app asks of the notification center, starting from the notifications given.
actor FakeNotificationCenter: DeliveredNotificationCenter {
    private(set) var badge: Int?
    private(set) var delivered: [DeliveredItemNotification]
    private(set) var posted: [LocalNotification] = []

    init(delivered: [DeliveredItemNotification] = []) {
        self.delivered = delivered
    }

    func setBadgeCount(_ count: Int) {
        badge = count
    }

    func deliveredItemNotifications() -> [DeliveredItemNotification] {
        delivered
    }

    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) {
        delivered.removeAll { identifiers.contains($0.identifier) }
    }

    func post(_ notification: LocalNotification) {
        posted.append(notification)
    }
}
