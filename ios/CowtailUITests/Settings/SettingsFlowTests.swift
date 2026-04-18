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
        XCTAssertEqual(
            element(in: app, identifier: "text.notifications.summary-title").label,
            "Notifications are off"
        )
        XCTAssertTrue(
            element(in: app, identifier: "text.notifications.summary-message").waitForExistence(timeout: 5),
            "The denied notifications state should expose the summary message identifier."
        )
        XCTAssertEqual(
            element(in: app, identifier: "text.notifications.summary-message").label,
            "Turn notifications back on in Settings."
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
        XCTAssertEqual(
            dailyRoundupToggle.value as? String,
            "1",
            "The ready notifications fixture should start with daily roundup enabled."
        )

        dailyRoundupToggle.tap()

        let toggledOffPredicate = NSPredicate(format: "value == '0'")
        expectation(for: toggledOffPredicate, evaluatedWith: dailyRoundupToggle)
        waitForExpectations(timeout: 5)
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
}
