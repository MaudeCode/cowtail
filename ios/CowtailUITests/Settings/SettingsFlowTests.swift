import XCTest

@MainActor
final class SettingsFlowTests: XCTestCase {
    /// Settings is no tab: Inbox's toolbar button pushes it.
    func testInboxOpensSettingsWithItsSectionsInTheFiguresOrder() {
        let app = AppLaunching.configuredApp(scenario: "notifications_ready")
        app.launch()

        let settings = app.buttons["button.inbox.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()

        app.assertSections(["Account", "Notifications", "Urgency overrides", "Appearance", "Devices", "Developer", "Links"])
        XCTAssertEqual(app.buttons["button.settings.add-override"].label, "Add override")
    }

    func testDailyRoundupToggleChangesItsValue() {
        let app = AppLaunching.configuredApp(scenario: "notifications_ready", startTab: "settings")
        app.launch()

        let toggle = app.switches["toggle.notifications.daily-roundup"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        let initialValue = String(describing: toggle.value ?? "")
        XCTAssertEqual(initialValue, "1", "The ready fixture starts with the daily roundup on.")

        toggle.switches.firstMatch.tap()

        expectation(for: NSPredicate(format: "value != %@", initialValue), evaluatedWith: toggle)
        waitForExpectations(timeout: 10)
    }

    func testNotificationsDeniedOffersSystemSettings() {
        let app = AppLaunching.configuredApp(scenario: "notifications_permission_denied", startTab: "settings")
        app.launch()

        XCTAssertTrue(app.element("text.notifications.summary-message").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["button.notifications.open-settings"].exists)
        XCTAssertFalse(app.buttons["button.notifications.primary-action"].exists)
    }

    func testSignedInWithOIDCNamesTheProviderAndOffersSignOut() {
        let app = AppLaunching.configuredApp(scenario: "signed_in_with_oidc", startTab: "settings")
        app.launch()

        let row = app.element("text.settings.signed-in")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertEqual(row.label, "Signed in with Pocket ID")
        XCTAssertEqual(app.buttons["button.settings.sign-out"].label, "Sign out")
        // The Pocket ID session registers pushes: Notifications asks for no Apple sign-in.
        XCTAssertFalse(app.buttons["button.sign-in.apple"].exists)
    }

    func testNotificationsSyncErrorOffersRetry() {
        let app = AppLaunching.configuredApp(scenario: "notifications_sync_error", startTab: "settings")
        app.launch()

        XCTAssertTrue(app.buttons["button.notifications.primary-action"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["button.notifications.open-settings"].exists)
    }
}
