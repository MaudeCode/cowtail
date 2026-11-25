import Foundation
import HTTPTypes
import OpenAPIRuntime
import UserNotifications
import XCTest
@testable import CowtailKit

final class ItemNotificationsTests: XCTestCase {
    private func actions(_ category: String) -> [UNNotificationAction] {
        ItemNotifications.categories().first { $0.identifier == category }?.actions ?? []
    }

    func testRegistersEveryItemCategoryTheServerSendsWithItsActions() {
        XCTAssertEqual(
            Set(ItemNotifications.categories().map(\.identifier)),
            ["ITEM_APPROVAL", "ITEM_APPROVAL_AUTH", "ITEM_QUESTION", "ITEM_ACK"]
        )
        XCTAssertEqual(actions("ITEM_APPROVAL").map(\.title), ["Approve", "Deny"])
        XCTAssertEqual(actions("ITEM_APPROVAL_AUTH").map(\.title), ["Approve", "Deny"])
        XCTAssertEqual(actions("ITEM_ACK").map(\.title), ["Acknowledge", "Snooze 1h"])

        let reply = actions("ITEM_QUESTION")
        XCTAssertEqual(reply.map(\.title), ["Reply"])
        XCTAssertEqual((reply.first as? UNTextInputNotificationAction)?.textInputButtonTitle, "Send")
    }

    func testOnlyTheProtectedApprovalCategoryRequiresAuthentication() {
        let authenticated = ItemNotifications.categories()
            .flatMap { category in
                category.actions
                    .filter { $0.options.contains(.authenticationRequired) }
                    .map { "\(category.identifier) \($0.title)" }
            }
            .sorted()
        XCTAssertEqual(authenticated, ["ITEM_APPROVAL_AUTH Approve", "ITEM_APPROVAL_AUTH Deny"])
        // Each answer tells the server whether its category asked for Face ID.
        XCTAssertEqual(
            ["ITEM_APPROVAL_AUTH", "ITEM_APPROVAL", "ITEM_ACK"].map { ItemNotifications.authenticated(categoryIdentifier: $0) },
            [true, false, nil]
        )
    }

    func testEachActionPostsItsBodyToTheItemActionsEndpoint() async throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        struct Case {
            let action: ItemNotifications.Action
            var replyText: String?
            let body: [String: AnyHashable]
        }
        let cases = [
            Case(action: .approve, body: ["type": "approve"]),
            Case(action: .deny, body: ["type": "deny"]),
            Case(action: .acknowledge, body: ["type": "ack"]),
            Case(action: .snooze, body: ["type": "snooze", "until": 1_800_003_600_000]),
            Case(action: .reply, replyText: "  Rebalance now ", body: ["type": "reply", "text": "Rebalance now"]),
        ]

        for testCase in cases {
            let action = testCase.action
            let replyText = testCase.replyText
            let expected = testCase.body
            let transport = RecordingTransport(routes: ["POST /api/me/items/item-1/actions": .init(json: Self.actedItem)])
            let request = try XCTUnwrap(
                ItemNotifications.request(actionIdentifier: action.rawValue, replyText: replyText, now: now)
            )

            _ = try await CowtailAPI(transport: transport).performItemAction(
                itemID: "item-1",
                request: request,
                authenticated: ItemNotifications.authenticated(categoryIdentifier: "ITEM_APPROVAL"),
                sessionToken: "session-token"
            )

            let sent = try XCTUnwrap(transport.requests.first)
            XCTAssertEqual(transport.requests.count, 1)
            XCTAssertEqual(sent.request.method, .post)
            // An answer from an approval category names whether it asked for Face ID.
            XCTAssertEqual(sent.request.path, "/api/me/items/item-1/actions?authenticated=false", "\(action)")
            XCTAssertEqual(sent.request.headerFields[.authorization], "Bearer session-token")
            XCTAssertEqual(
                try JSONSerialization.jsonObject(with: sent.body) as? [String: AnyHashable],
                expected,
                "\(action)"
            )
        }
    }

    @MainActor
    func testOpeningAnItemPushOpensTheItemAndASummaryOpensTheInbox() {
        let cases: [([String: String], [AppRoute])] = [
            (["itemId": "item-1", "alertId": "alert-1"], [.item("item-1")]),
            (["type": "item_batch"], []),
        ]
        for (userInfo, path) in cases {
            let router = UniversalLinkRouter.makeForTesting()
            router.openRoundup(RoundupRoute(from: "2026-04-10", to: "2026-04-10"))

            XCTAssertTrue(router.handleNotification(userInfo: userInfo), "\(userInfo)")
            XCTAssertEqual(router.selectedTab, .inbox, "\(userInfo)")
            XCTAssertEqual(router.inboxPath, path, "\(userInfo)")
        }
    }

    func testATapAnEmptyReplyOrAnotherActionSendsNothing() {
        let now = Date()
        XCTAssertNil(ItemNotifications.request(actionIdentifier: UNNotificationDefaultActionIdentifier, replyText: nil, now: now))
        XCTAssertNil(ItemNotifications.request(actionIdentifier: ItemNotifications.Action.reply.rawValue, replyText: "  ", now: now))
    }
}

private extension ItemNotificationsTests {
    /// The server's answer to a successful item action.
    static let actedItem = """
    {"ok":true,"item":{"id":"item-1","source":"hermes",\
    "sourceInfo":{"slug":"hermes","displayName":"Hermes"},"kind":"approval","urgency":"now",\
    "state":"open","needsOwner":true,"title":"Restart ingress in edge?","body":"","links":[],\
    "context":{},"occurrenceCount":1,"actions":[{"type":"approve"},{"type":"deny"}],\
    "availableActions":[{"type":"approve"},{"type":"deny"}],\
    "createdAt":1,"updatedAt":2}}
    """
}
