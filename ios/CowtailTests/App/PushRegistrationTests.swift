import Foundation
import HTTPTypes
import XCTest
@testable import Cowtail

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
}
