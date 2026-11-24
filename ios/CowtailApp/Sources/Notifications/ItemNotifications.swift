import Foundation
import UserNotifications

/// The categories the server sets on item pushes, their actions, and the item action each sends.
enum ItemNotifications {
    enum Category {
        static let approval = "ITEM_APPROVAL"
        /// The server sends approvals in this one while the owner requires Face ID.
        static let approvalWithAuth = "ITEM_APPROVAL_AUTH"
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

    /// Whether a notification's Approve and Deny asked for Face ID.
    enum Origin: String {
        case protected
        case unprotected
    }

    /// The origin the server checks an answer from this category against; nil for categories
    /// without approvals.
    static func origin(categoryIdentifier: String) -> Origin? {
        switch categoryIdentifier {
        case Category.approvalWithAuth: .protected
        case Category.approval: .unprotected
        default: nil
        }
    }

    /// Every item category. The server picks the approval one per push from the owner's
    /// setting, so each device protects Approve and Deny alike.
    static func categories() -> Set<UNNotificationCategory> {
        [
            approvalCategory(Category.approval, options: []),
            approvalCategory(Category.approvalWithAuth, options: [.authenticationRequired]),
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

    private static func approvalCategory(
        _ identifier: String,
        options: UNNotificationActionOptions
    ) -> UNNotificationCategory {
        UNNotificationCategory(
            identifier: identifier,
            actions: [
                UNNotificationAction(identifier: Action.approve.rawValue, title: "Approve", options: options),
                UNNotificationAction(
                    identifier: Action.deny.rawValue,
                    title: "Deny",
                    options: options.union(.destructive)
                ),
            ],
            intentIdentifiers: []
        )
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
