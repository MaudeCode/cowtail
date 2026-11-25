import UIKit
import XCTest
@testable import Cowtail

@MainActor
final class HostedSignInTests: XCTestCase {
    func testSigningInOffersNotificationsBeforeInbox() throws {
        let screen = try HostedScreen.root(.signedOutWithOIDC)
        defer { screen.close() }
        try screen.activate("button.sign-in.oidc")
        screen.assertVisible(["button.notification-step.not-now", "button.notification-step.turn-on"])
        try screen.activate("button.notification-step.not-now")
        screen.assertVisible(["button.inbox.settings"])
    }

    func testSigningOutFromSettingsReturnsToSignIn() throws {
        let screen = try HostedScreen.root(.signedInWithOIDC, settings: true)
        defer { screen.close() }
        try screen.activate("button.settings.sign-out")
        screen.assertVisible(["button.sign-in.oidc"])
        XCTAssertNil(screen.firstView(ofType: UITabBar.self))
    }
}
