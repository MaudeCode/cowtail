import Foundation
import UserNotifications
import XCTest
@testable import CowtailKit

/// An answer from a notification button runs with the app out of sight, so a failure has to
/// reach the owner as a notification of its own.
@MainActor
final class NotificationAnswerTests: XCTestCase {
    private static let actionRoute = "POST /api/me/items/item-1/actions"

    override func setUp() async throws {
        AppSessionManager.shared.resetForUITesting()
        AppSessionManager.shared.store(
            AppAuthSession(token: "session", userID: "owner", expiresAt: .distantFuture),
            provider: "Pocket ID"
        )
    }

    override func tearDown() async throws {
        AppSessionManager.shared.resetForUITesting()
    }

    func testAnOfflineAnswerPostsAFailureThatOpensTheItemInItsThread() async {
        let posted = await approve(answeredWith: .init(failure: URLError(.notConnectedToInternet)))

        XCTAssertEqual(posted, [
            LocalNotification(
                title: "Couldn't approve “Restart deployer”",
                body: "You're offline. Open Cowtail to retry.",
                threadIdentifier: "deployer:restart",
                userInfo: ["itemId": "item-1"]
            ),
        ])
    }

    func testAnAnswerTheServerDoesNotAuthorizeAsksToSignInAgain() async {
        let posted = await approve(answeredWith: .init(status: .unauthorized, json: #"{"ok":false,"error":"Unauthorized"}"#))

        XCTAssertEqual(posted.map(\.body), ["Sign in to Cowtail again. Open Cowtail to retry."])
    }

    func testARefusedAnswerGivesTheServersReason() async {
        let posted = await approve(answeredWith: .init(
            status: .forbidden,
            json: #"{"ok":false,"error":"Approvals need Face ID: answer again in Cowtail","code":"APPROVAL_NEEDS_AUTH"}"#
        ))

        XCTAssertEqual(
            posted.map(\.body),
            ["Approvals need Face ID: answer again in Cowtail. Open Cowtail to retry."]
        )
    }

    func testASuccessfulAnswerPostsNothing() async {
        let posted = await approve(answeredWith: .init(json: Self.approvedItem))

        XCTAssertEqual(posted, [])
    }

    /// iOS calls the delegate through its Objective-C entry point and asserts that the completion
    /// handler runs on the main thread. An acknowledgement that finished elsewhere aborted the app.
    func testALockScreenAcknowledgementCompletesOnTheMainThread() async throws {
        let transport = RecordingTransport(routes: [Self.actionRoute: .init(json: Self.approvedItem)])
        let notifications = NotificationManager(
            api: CowtailAPI(transport: transport),
            notificationCenter: FakeNotificationCenter()
        )
        let response = try Self.response(
            to: Self.notification(categoryIdentifier: ItemNotifications.Category.ack),
            action: ItemNotifications.Action.acknowledge.rawValue
        )

        let completedOnMainThread = await withCheckedContinuation { continuation in
            typealias DidReceive = @convention(c) (
                NSObject, Selector, NSObject, UNNotificationResponse, @convention(block) () -> Void
            ) -> Void
            let selector = NSSelectorFromString("userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:")
            let completionHandler: @convention(block) () -> Void = {
                continuation.resume(returning: Thread.isMainThread)
            }
            unsafeBitCast(notifications.method(for: selector), to: DidReceive.self)(
                notifications, selector, NSObject(), response, completionHandler
            )
        }

        XCTAssertTrue(completedOnMainThread)
        XCTAssertEqual(transport.requests(Self.actionRoute).count, 1)
    }

    func testAPushShownInTheForegroundCompletesOnTheMainThread() async throws {
        let notifications = NotificationManager(
            api: CowtailAPI(transport: RecordingTransport(routes: [:])),
            notificationCenter: FakeNotificationCenter()
        )
        let notification = try Self.notification(categoryIdentifier: ItemNotifications.Category.ack)

        let completedOnMainThread = await withCheckedContinuation { continuation in
            typealias WillPresent = @convention(c) (
                NSObject, Selector, NSObject, UNNotification, @convention(block) (UNNotificationPresentationOptions) -> Void
            ) -> Void
            let selector = NSSelectorFromString("userNotificationCenter:willPresentNotification:withCompletionHandler:")
            let completionHandler: @convention(block) (UNNotificationPresentationOptions) -> Void = { _ in
                continuation.resume(returning: Thread.isMainThread)
            }
            unsafeBitCast(notifications.method(for: selector), to: WillPresent.self)(
                notifications, selector, NSObject(), notification, completionHandler
            )
        }

        XCTAssertTrue(completedOnMainThread)
    }

    /// item-1's push as iOS delivers it. UserNotifications offers no public initializer, so these
    /// use the class methods it builds delivered notifications with.
    private static func notification(categoryIdentifier: String) throws -> UNNotification {
        let content = UNMutableNotificationContent()
        content.title = "Restart deployer"
        content.categoryIdentifier = categoryIdentifier
        content.threadIdentifier = "deployer:restart"
        content.userInfo = ["itemId": "item-1"]
        let request = UNNotificationRequest(identifier: "item-1", content: content, trigger: nil)
        return try XCTUnwrap((UNNotification.self as AnyObject)
            .perform(NSSelectorFromString("notificationWithRequest:date:"), with: request, with: Date(timeIntervalSince1970: 0))
            .takeUnretainedValue() as? UNNotification)
    }

    private static func response(to notification: UNNotification, action: String) throws -> UNNotificationResponse {
        try XCTUnwrap((UNNotificationResponse.self as AnyObject)
            .perform(NSSelectorFromString("responseWithNotification:actionIdentifier:"), with: notification, with: action)
            .takeUnretainedValue() as? UNNotificationResponse)
    }

    /// Approves item-1 from its push against a server that answers the action as given.
    private func approve(answeredWith route: RecordingTransport.Route) async -> [LocalNotification] {
        let transport = RecordingTransport(routes: [Self.actionRoute: route])
        let center = FakeNotificationCenter()
        let notifications = NotificationManager(api: CowtailAPI(transport: transport), notificationCenter: center)

        await notifications.answer(
            .approve,
            request: .approve,
            authenticated: false,
            itemID: "item-1",
            itemTitle: "Restart deployer",
            threadIdentifier: "deployer:restart"
        )

        XCTAssertEqual(transport.requests(Self.actionRoute).count, 1)
        return await center.posted
    }

    private static let approvedItem = """
    {"ok":true,"item":{"id":"item-1","source":"hermes",\
    "sourceInfo":{"slug":"hermes","displayName":"Hermes"},"kind":"approval","urgency":"now",\
    "state":"open","needsOwner":true,"title":"Restart deployer","body":"","links":[],\
    "context":{},"occurrenceCount":1,"actions":[{"type":"approve"},{"type":"deny"}],\
    "availableActions":[{"type":"approve"},{"type":"deny"}],"createdAt":1,"updatedAt":2}}
    """
}
