import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedSettingsTests: XCTestCase {
    func testInboxToolbarOpensSettingsWithSectionsInOrder() throws {
        let screen = try HostedScreen.root(.notificationsReady)
        defer { screen.close() }
        try screen.activate("button.inbox.settings")
        let sections = ["Account", "Notifications", "Urgency overrides", "Appearance", "Devices", "Developer", "Links"]
            .map { "section.\($0)" }
        screen.assertVisible(sections + ["button.settings.add-override"])
        screen.assertVerticalOrder(sections)
        XCTAssertEqual(screen.element("button.settings.add-override")?.accessibilityLabel, "Add override")
    }

    func testDailyRoundupToggleChangesValue() throws {
        let screen = try HostedScreen.root(.notificationsReady, settings: true)
        defer { screen.close() }
        let id = "toggle.notifications.daily-roundup"
        screen.assertVisible([id])
        XCTAssertEqual(screen.element(id)?.accessibilityValue, "1")
        try screen.activate(id)
        screen.assertValue("0", for: id)
    }

    func testDeniedNotificationsOfferSystemSettings() throws {
        let screen = try HostedScreen.root(.notificationsPermissionDenied, settings: true)
        defer { screen.close() }
        screen.assertVisible(["text.notifications.summary-message", "button.notifications.open-settings"])
        XCTAssertNil(screen.element("button.notifications.primary-action"))
    }

    func testOIDCSessionNamesProviderAndOffersSignOut() throws {
        let screen = try HostedScreen.root(.signedInWithOIDC, settings: true)
        defer { screen.close() }
        screen.assertVisible(["text.settings.signed-in", "button.settings.sign-out"])
        XCTAssertEqual(screen.element("text.settings.signed-in")?.accessibilityLabel, "Signed in with Pocket ID")
        XCTAssertEqual(screen.element("button.settings.sign-out")?.accessibilityLabel, "Sign out")
        XCTAssertNil(screen.element("button.sign-in.apple"))
    }

    func testNotificationSyncErrorOffersRetry() throws {
        let screen = try HostedScreen.root(.notificationsSyncError, settings: true)
        defer { screen.close() }
        screen.assertVisible(["button.notifications.primary-action"])
        XCTAssertNil(screen.element("button.notifications.open-settings"))
    }
}
