import Foundation
import UserNotifications

/// The categories the server sets on item pushes, their actions, and the item action each sends.
enum ItemNotifications {
    enum Category {
        static let approval = "ITEM_APPROVAL"
        static let question = "ITEM_QUESTION"
        static let ack = "ITEM_ACK"
    }

    enum Action: String, CaseIterable {
        case approve = "ITEM_APPROVE"
        case deny = "ITEM_DENY"
        case reply = "ITEM_REPLY"
        case acknowledge = "ITEM_ACKNOWLEDGE"
        case snooze = "ITEM_SNOOZE_1H"
    }

    static let snoozeInterval: TimeInterval = 60 * 60

    /// Approve and Deny ask for Face ID or the passcode while the owner requires it.
    static func categories(requireAuthForApprovals: Bool) -> Set<UNNotificationCategory> {
        let approval: UNNotificationActionOptions = requireAuthForApprovals ? [.authenticationRequired] : []
        return [
            UNNotificationCategory(
                identifier: Category.approval,
                actions: [
                    UNNotificationAction(identifier: Action.approve.rawValue, title: "Approve", options: approval),
                    UNNotificationAction(
                        identifier: Action.deny.rawValue,
                        title: "Deny",
                        options: approval.union(.destructive)
                    ),
                ],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: Category.question,
                actions: [
                    UNTextInputNotificationAction(
                        identifier: Action.reply.rawValue,
                        title: "Reply",
                        options: [],
                        textInputButtonTitle: "Send",
                        textInputPlaceholder: "Reply"
                    ),
                ],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: Category.ack,
                actions: [
                    UNNotificationAction(identifier: Action.acknowledge.rawValue, title: "Acknowledge", options: []),
                    UNNotificationAction(identifier: Action.snooze.rawValue, title: "Snooze 1h", options: []),
                ],
                intentIdentifiers: []
            ),
        ]
    }

    /// The action a notification button sends; nil for a tap, a dismissal or an empty reply.
    static func request(
        actionIdentifier: String,
        replyText: String?,
        now: Date
    ) -> ItemActionRequest? {
        switch Action(rawValue: actionIdentifier) {
        case .approve:
            return .approve
        case .deny:
            return .deny
        case .acknowledge:
            return .ack
        case .snooze:
            return .snooze(until: now.addingTimeInterval(snoozeInterval))
        case .reply:
            guard let text = replyText?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                return nil
            }
            return .reply(text)
        case nil:
            return nil
        }
    }
}
