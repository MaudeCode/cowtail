import XCTest

@MainActor
final class InboxFlowTests: XCTestCase {
    func testInboxPopulatedRendersInboxScreen() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")

        app.launch()

        XCTAssertTrue(
            element(in: app, identifier: "screen.inbox").waitForExistence(timeout: 5),
            "screen.inbox is expected once Task 6 adds accessibility identifiers."
        )
    }

    func testInboxPopulatedCanExpandActiveAlerts() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")

        app.launch()

        let showMoreButton = app.buttons["button.inbox.show-more.active-alerts"]
        let fourthAlertRow = app.buttons["row.alert.preview-alert-5"]

        XCTAssertTrue(
            showMoreButton.waitForExistence(timeout: 5),
            "The active alerts show-more button should appear once the seeded inbox includes more than three actionable alerts."
        )

        XCTAssertFalse(
            fourthAlertRow.exists,
            "The fourth actionable alert should stay hidden before expanding the section."
        )

        showMoreButton.tap()

        XCTAssertTrue(
            fourthAlertRow.waitForExistence(timeout: 5),
            "Expanding active alerts should reveal the fourth actionable alert row."
        )
    }

    func testInboxPopulatedCanOpenAlertDetail() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")

        app.launch()

        let alertRow = app.buttons["row.alert.preview-alert"]
        XCTAssertTrue(
            alertRow.waitForExistence(timeout: 5),
            "A seeded inbox alert row should be tappable from the populated inbox scenario."
        )

        alertRow.tap()

        XCTAssertTrue(
            element(in: app, identifier: "screen.alert-detail").waitForExistence(timeout: 5),
            "Tapping a seeded inbox row should navigate to the alert detail screen."
        )
    }

    func testMissingAlertDeepLinkShowsUnavailableState() {
        let app = AppLaunching.configuredApp(
            scenario: "alert_deep_link_missing",
            deepLinkURL: "https://cowtail.thezoo.house/alerts/missing-alert"
        )

        app.launch()

        XCTAssertTrue(
            element(in: app, identifier: "screen.alert-detail.unavailable").waitForExistence(timeout: 5),
            "Missing alert deep links should land on the unavailable detail state."
        )
    }

    private func element(in app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
