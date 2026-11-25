import Foundation
import HTTPTypes
import XCTest
@testable import CowtailKit

@MainActor
final class PushRegistrationTests: XCTestCase {
    private let sessions = AppSessionManager.shared

    override func setUp() async throws {
        Self.clearSignInAndPushState()
    }

    override func tearDown() async throws {
        Self.clearSignInAndPushState()
    }

    /// Sign-in and the synced registration persist in the keychain and defaults the app shares.
    private static func clearSignInAndPushState() {
        AppleAccountManager.shared.resetForUITesting()
        AppSessionManager.shared.resetForUITesting()
        NotificationManager().resetForUITesting()
    }

    func testAPocketIDSessionRegistersTheDeviceWithItsBearer() async throws {
        sessions.store(
            AppAuthSession(token: "oidc-session", userID: "owner", expiresAt: .distantFuture),
            provider: "Pocket ID"
        )
        let transport = RecordingTransport(routes: [
            "POST /api/push/register": .init(json: #"{"ok":true,"created":true,"id":"device-1"}"#),
        ])
        let notifications = NotificationManager(api: CowtailAPI(transport: transport), deviceToken: "apns-device")

        await notifications.syncDeviceRegistration()

        XCTAssertEqual(notifications.serverRegistrationState, .registered)
        let posted = try XCTUnwrap(transport.requests("POST /api/push/register").first)
        XCTAssertEqual(posted.request.headerFields[.authorization], "Bearer oidc-session")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: posted.body) as? [String: String])
        XCTAssertEqual(body["deviceToken"], "apns-device")
        XCTAssertNil(body["identityToken"])
    }

    /// The server stops pushing to a device when the session that registered it ends.
    func testANewSessionRegistersTheDeviceAgain() async {
        let transport = RecordingTransport(routes: [
            "POST /api/push/register": .init(json: #"{"ok":true,"created":false,"id":"device-1"}"#),
        ])
        let notifications = NotificationManager(api: CowtailAPI(transport: transport), deviceToken: "apns-device")
        for token in ["first-session", "second-session"] {
            sessions.store(
                AppAuthSession(token: token, userID: "owner", expiresAt: .distantFuture),
                provider: "Pocket ID"
            )
            await notifications.syncDeviceRegistration()
        }

        let bearers = transport.requests("POST /api/push/register").map { $0.request.headerFields[.authorization] }
        XCTAssertEqual(bearers, ["Bearer first-session", "Bearer second-session"])
        XCTAssertEqual(notifications.serverRegistrationState, .registered)
    }

    /// A reinstall or restore keeps the keychain, while APNs issues the app a new token.
    func testALaunchAsksAPNsForATokenAgainAndRegistersTheOneItReturns() async throws {
        let transport = signedInServer()
        await launchAndDeliver(token: Data([0x01, 0xde, 0xad]), server: transport)

        let (relaunch, apns) = await launch(server: transport)
        await relaunch.didRegister(deviceToken: Data([0x02, 0xbe, 0xef]))

        XCTAssertEqual(apns.registrations, 1)
        let tokens = try transport.requests("POST /api/push/register").map(Self.deviceToken(of:))
        XCTAssertEqual(tokens, ["01dead", "02beef"])
    }

    /// The server's registration may have been deleted or disabled since the last launch.
    func testALaunchRegistersWithTheServerWhenNothingChanged() async {
        let transport = signedInServer()
        await launchAndDeliver(token: Data([0x01, 0xde, 0xad]), server: transport)

        await launchAndDeliver(token: Data([0x01, 0xde, 0xad]), server: transport)

        XCTAssertEqual(transport.requests("POST /api/push/register").count, 2)
    }

    func testPushIsNotReadyUntilAPNsAnswersThisLaunch() async {
        let transport = signedInServer()
        await launchAndDeliver(token: Data([0x01, 0xde, 0xad]), server: transport)

        let (relaunch, _) = await launch(server: transport)

        XCTAssertFalse(relaunch.isReadyForRemotePush)
    }

    private func signedInServer() -> RecordingTransport {
        sessions.store(
            AppAuthSession(token: "oidc-session", userID: "owner", expiresAt: .distantFuture),
            provider: "Pocket ID"
        )
        return RecordingTransport(routes: [
            "POST /api/push/register": .init(json: #"{"ok":true,"created":false,"id":"device-1"}"#),
        ])
    }

    /// A launch with notifications allowed, before APNs answers.
    private func launch(server: RecordingTransport) async -> (NotificationManager, FakeAPNs) {
        let apns = FakeAPNs()
        let notifications = NotificationManager(
            api: CowtailAPI(transport: server),
            authorizationStatus: { .authorized },
            registerWithAPNs: { apns.registrations += 1 }
        )
        await notifications.registerAtLaunch()
        return (notifications, apns)
    }

    private func launchAndDeliver(token: Data, server: RecordingTransport) async {
        let (notifications, _) = await launch(server: server)
        await notifications.didRegister(deviceToken: token)
    }

    private static func deviceToken(of posted: (request: HTTPRequest, body: Data)) throws -> String? {
        try (JSONSerialization.jsonObject(with: posted.body) as? [String: Any])?["deviceToken"] as? String
    }
}

@MainActor
private final class FakeAPNs {
    var registrations = 0
}
