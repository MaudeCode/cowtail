import Foundation
import UserNotifications

/// A delivered notification and the items it announces: one for an item push, every item of a
/// `today` batch that lists them, none for anything else (the roundup, a test notification).
struct DeliveredItemNotification: Equatable, Sendable {
    let identifier: String
    let itemIDs: [String]

    init(identifier: String, itemIDs: [String]) {
        self.identifier = identifier
        self.itemIDs = itemIDs
    }

    init(identifier: String, userInfo: [AnyHashable: Any]) {
        let itemIDs = (userInfo["itemId"] as? String).map { [$0] } ?? userInfo["itemIds"] as? [String]
        self.init(identifier: identifier, itemIDs: itemIDs ?? [])
    }
}

/// A notification the app posts itself, at once.
struct LocalNotification: Equatable, Sendable {
    let title: String
    let body: String
    /// Groups it with the push it is about.
    let threadIdentifier: String
    /// What a tap opens, read as a push's is.
    let userInfo: [String: String]
}

/// The notification center calls that keep the badge and delivered notifications in line with
/// the server, and post the app's own notifications; unit tests fake it.
protocol DeliveredNotificationCenter: Sendable {
    func setBadgeCount(_ count: Int) async
    func deliveredItemNotifications() async -> [DeliveredItemNotification]
    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) async
    func post(_ notification: LocalNotification) async
}

struct SystemNotificationCenter: DeliveredNotificationCenter {
    func setBadgeCount(_ count: Int) async {
        try? await UNUserNotificationCenter.current().setBadgeCount(count)
    }

    func deliveredItemNotifications() async -> [DeliveredItemNotification] {
        await UNUserNotificationCenter.current().deliveredNotifications().map { notification in
            DeliveredItemNotification(
                identifier: notification.request.identifier,
                userInfo: notification.request.content.userInfo
            )
        }
    }

    func removeDeliveredNotifications(withIdentifiers identifiers: [String]) async {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    func post(_ notification: LocalNotification) async {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        content.threadIdentifier = notification.threadIdentifier
        content.userInfo = notification.userInfo
        content.sound = .default
        try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        )
    }
}

/// The server decides the badge and which items stay live; the app only applies them. An item
/// notification goes once none of its items is live, so a batch stays while any of its items does.
enum DeliveredNotifications {
    /// Applied on every inbox load, which every return to the foreground runs: the guarantee.
    static func show(badge: Int, liveItemIDs: Set<String>, in center: any DeliveredNotificationCenter) async {
        await update(badge: badge, in: center) { !liveItemIDs.contains($0) }
    }

    fileprivate static func update(
        badge: Int,
        in center: any DeliveredNotificationCenter,
        handled: (String) -> Bool
    ) async {
        await center.setBadgeCount(badge)
        let stale = await center.deliveredItemNotifications()
            .filter { !$0.itemIDs.isEmpty && $0.itemIDs.allSatisfy(handled) }
            .map(\.identifier)
        if !stale.isEmpty {
            await center.removeDeliveredNotifications(withIdentifiers: stale)
        }
    }
}

/// The background push the server sends a few seconds after items stop being live. iOS
/// throttles background pushes, so this is only the fast path; the inbox's badge and live items,
/// applied on every load and every return to the foreground, are the guarantee.
struct ItemSyncPush: Equatable, Sendable {
    let badge: Int
    let itemIDs: Set<String>

    init?(userInfo: [AnyHashable: Any]) {
        guard userInfo["type"] as? String == "item_sync",
              let badge = userInfo["badge"] as? Int,
              let itemIDs = userInfo["itemIds"] as? [String]
        else {
            return nil
        }
        self.badge = badge
        self.itemIDs = Set(itemIDs)
    }

    func apply(in center: any DeliveredNotificationCenter) async {
        await DeliveredNotifications.update(badge: badge, in: center) { itemIDs.contains($0) }
    }
}
