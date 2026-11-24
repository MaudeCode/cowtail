import XCTest

@MainActor
final class SettingsFlowTests: XCTestCase {
    func testSettingsShowsItsSectionsInTheFiguresOrder() {
        let app = AppLaunching.configuredApp(scenario: "notifications_ready", startTab: "settings")
        app.launch()

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

    func testNotificationsNeedsAppleOffersAppleSignIn() {
        let app = AppLaunching.configuredApp(scenario: "notifications_needs_apple", startTab: "settings")
        app.launch()

        XCTAssertTrue(app.buttons["button.notifications.apple-sign-in"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["button.notifications.primary-action"].exists)
    }

    func testNotificationsSyncErrorOffersRetry() {
        let app = AppLaunching.configuredApp(scenario: "notifications_sync_error", startTab: "settings")
        app.launch()

        XCTAssertTrue(app.buttons["button.notifications.primary-action"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["button.notifications.open-settings"].exists)
    }
}
