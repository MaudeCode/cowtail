import Foundation
import HTTPTypes
import OpenAPIRuntime
import UserNotifications
import XCTest
@testable import Cowtail

final class ItemNotificationsTests: XCTestCase {
    private func actions(_ category: String, requireAuth: Bool) -> [UNNotificationAction] {
        ItemNotifications.categories(requireAuthForApprovals: requireAuth)
            .first { $0.identifier == category }?.actions ?? []
    }

    func testRegistersTheThreeItemCategoriesWithTheirActions() {
        let categories = ItemNotifications.categories(requireAuthForApprovals: false)

        XCTAssertEqual(
            Set(categories.map(\.identifier)),
            ["ITEM_APPROVAL", "ITEM_QUESTION", "ITEM_ACK"]
        )
        XCTAssertEqual(actions("ITEM_APPROVAL", requireAuth: false).map(\.title), ["Approve", "Deny"])
        XCTAssertEqual(actions("ITEM_ACK", requireAuth: false).map(\.title), ["Acknowledge", "Snooze 1h"])

        let reply = actions("ITEM_QUESTION", requireAuth: false)
        XCTAssertEqual(reply.map(\.title), ["Reply"])
        XCTAssertEqual((reply.first as? UNTextInputNotificationAction)?.textInputButtonTitle, "Send")
    }

    func testApproveAndDenyRequireAuthenticationExactlyWhenTheSettingIsOn() {
        for requireAuth in [false, true] {
            let all = ItemNotifications.categories(requireAuthForApprovals: requireAuth).flatMap(\.actions)
            let authenticated = all.filter { $0.options.contains(.authenticationRequired) }.map(\.title)
            XCTAssertEqual(authenticated, requireAuth ? ["Approve", "Deny"] : [], "requireAuth=\(requireAuth)")
        }
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
            let transport = RecordingTransport()
            let request = try XCTUnwrap(
                ItemNotifications.request(actionIdentifier: action.rawValue, replyText: replyText, now: now)
            )

            try await CowtailAPI(transport: transport)
                .performItemAction(itemID: "item-1", request: request, sessionToken: "session-token")

            let sent = try XCTUnwrap(transport.requests.first)
            XCTAssertEqual(transport.requests.count, 1)
            XCTAssertEqual(sent.request.method, .post)
            XCTAssertEqual(sent.request.path, "/api/me/items/item-1/actions", "\(action)")
            XCTAssertEqual(sent.request.headerFields[.authorization], "Bearer session-token")
            XCTAssertEqual(
                try JSONSerialization.jsonObject(with: sent.body) as? [String: AnyHashable],
                expected,
                "\(action)"
            )
        }
    }

    @MainActor
    func testOpeningAnItemOrSummaryPushOpensTheInbox() {
        for userInfo: [String: String] in [["itemId": "item-1"], ["type": "item_batch"]] {
            let router = UniversalLinkRouter.makeForTesting()
            router.openRoundup(RoundupRoute(from: "2026-04-10", to: "2026-04-10"))

            XCTAssertTrue(router.handleNotification(userInfo: userInfo), "\(userInfo)")
            XCTAssertEqual(router.selectedTab, .inbox, "\(userInfo)")
        }
    }

    func testATapAnEmptyReplyOrAnotherActionSendsNothing() {
        let now = Date()
        XCTAssertNil(ItemNotifications.request(actionIdentifier: UNNotificationDefaultActionIdentifier, replyText: nil, now: now))
        XCTAssertNil(ItemNotifications.request(actionIdentifier: ItemNotifications.Action.reply.rawValue, replyText: "  ", now: now))
    }
}

/// Answers every request as the server answers a successful item action.
private final class RecordingTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [(request: HTTPRequest, body: Data)] = []

    var requests: [(request: HTTPRequest, body: Data)] {
        lock.withLock { recorded }
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var full = request
        full.path = baseURL.path + (request.path ?? "")
        let bytes = body == nil ? Data() : try await Data(collecting: body!, upTo: 65_536)
        lock.withLock { recorded.append((full, bytes)) }

        let item = """
        {"ok":true,"item":{"id":"item-1","source":"hermes","kind":"approval","urgency":"now",\
        "state":"open","needsOwner":true,"title":"Restart ingress in edge?","body":"","links":[],\
        "context":{},"occurrenceCount":1,"actions":[{"type":"approve"},{"type":"deny"}],\
        "createdAt":1,"updatedAt":2}}
        """
        var headers = HTTPFields()
        headers[.contentType] = "application/json"
        return (HTTPResponse(status: .ok, headerFields: headers), HTTPBody(item))
    }
}
