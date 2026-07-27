import XCTest

@MainActor
final class SettingsFlowTests: XCTestCase {
    func testFarmhouseLoadsAndNavigatesToNotifications() {
        let app = AppLaunching.configuredApp(
            scenario: "notifications_ready",
            startTab: "farmhouse"
        )

        app.launch()

        let farmhouseScreen = element(in: app, identifier: "screen.farmhouse")
        let notificationsCard = app.buttons["card.farmhouse.notifications"]

        XCTAssertTrue(
            farmhouseScreen.waitForExistence(timeout: 5),
            "The farmhouse tab should expose screen.farmhouse."
        )
        XCTAssertTrue(
            notificationsCard.waitForExistence(timeout: 5),
            "The farmhouse notifications card should expose card.farmhouse.notifications."
        )

        notificationsCard.tap()

        XCTAssertTrue(
            element(in: app, identifier: "screen.notifications").waitForExistence(timeout: 5),
            "Tapping the farmhouse notifications card should navigate to the notifications settings screen."
        )
    }

    func testNotificationsDeniedShowsOpenSettingsAction() {
        let app = AppLaunching.configuredApp(
            scenario: "notifications_permission_denied",
            startTab: "farmhouse"
        )

        app.launch()

        openNotifications(from: app)

        XCTAssertTrue(
            element(in: app, identifier: "text.notifications.summary-title").waitForExistence(timeout: 5),
            "The notifications screen should expose the summary title identifier."
        )
        XCTAssertTrue(
            element(in: app, identifier: "text.notifications.summary-message").waitForExistence(timeout: 5),
            "The denied notifications state should expose the summary message identifier."
        )
        XCTAssertTrue(
            app.buttons["button.notifications.open-settings"].waitForExistence(timeout: 5),
            "The denied notifications state should expose an open-settings action."
        )
        XCTAssertFalse(
            app.buttons["button.notifications.primary-action"].exists,
            "The denied notifications state should not expose the primary setup action."
        )
    }

    func testDailyRoundupToggleMutatesFixtureState() {
        let app = AppLaunching.configuredApp(
            scenario: "notifications_ready",
            startTab: "farmhouse"
        )

        app.launch()

        openNotifications(from: app)

        let dailyRoundupToggle = app.switches["toggle.notifications.daily-roundup"]
        XCTAssertTrue(
            dailyRoundupToggle.waitForExistence(timeout: 5),
            "The notifications settings screen should expose the daily roundup toggle identifier."
        )
        let initialValue = switchValue(for: dailyRoundupToggle)
        XCTAssertEqual(
            initialValue,
            "1",
            "The ready notifications fixture should start with daily roundup enabled."
        )

        dailyRoundupToggle.tap()
        let valueChangedPredicate = NSPredicate(format: "value != %@", initialValue)
        expectation(for: valueChangedPredicate, evaluatedWith: dailyRoundupToggle)
        waitForExpectations(timeout: 2)

        XCTAssertNotEqual(
            switchValue(for: dailyRoundupToggle),
            initialValue,
            "Tapping the daily roundup toggle should change its switch value from the initial state."
        )
    }

    func testNotificationsNeedsAppleShowsAppleSignInAction() {
        let app = AppLaunching.configuredApp(
            scenario: "notifications_needs_apple",
            startTab: "farmhouse"
        )

        app.launch()

        openNotifications(from: app)

        XCTAssertTrue(
            element(in: app, identifier: "text.notifications.summary-title").waitForExistence(timeout: 5),
            "The needs-apple scenario should expose the notifications summary title."
        )
        XCTAssertTrue(
            app.buttons["button.notifications.apple-sign-in"].waitForExistence(timeout: 5),
            "The needs-apple scenario should expose the Apple sign-in action."
        )
        XCTAssertFalse(
            app.buttons["button.notifications.primary-action"].exists,
            "The needs-apple scenario should not show the primary setup action."
        )
    }

    func testNotificationsSyncErrorShowsRetrySetupAction() {
        let app = AppLaunching.configuredApp(
            scenario: "notifications_sync_error",
            startTab: "farmhouse"
        )

        app.launch()

        openNotifications(from: app)

        XCTAssertTrue(
            element(in: app, identifier: "text.notifications.summary-title").waitForExistence(timeout: 5),
            "The sync-error scenario should expose the notifications summary title."
        )
        XCTAssertTrue(
            app.buttons["button.notifications.primary-action"].waitForExistence(timeout: 5),
            "The sync-error scenario should expose the retry/setup primary action."
        )
        XCTAssertFalse(
            app.buttons["button.notifications.open-settings"].exists,
            "The sync-error scenario should not show the open-settings action."
        )
    }

    private func openNotifications(from app: XCUIApplication) {
        let notificationsCard = app.buttons["card.farmhouse.notifications"]
        XCTAssertTrue(
            notificationsCard.waitForExistence(timeout: 5),
            "The farmhouse notifications card should be available before navigating to notifications."
        )

        notificationsCard.tap()

        XCTAssertTrue(
            element(in: app, identifier: "screen.notifications").waitForExistence(timeout: 5),
            "The notifications settings screen should load after tapping the farmhouse notifications card."
        )
    }

    private func element(in app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func switchValue(for element: XCUIElement) -> String {
        String(describing: element.value ?? "")
    }
}
