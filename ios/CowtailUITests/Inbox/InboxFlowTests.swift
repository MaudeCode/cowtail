import XCTest

final class InboxFlowTests: XCTestCase {
    func testInboxPopulatedRendersInboxScreen() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")

        app.launch()

        XCTAssertTrue(
            app.otherElements["screen.inbox"].waitForExistence(timeout: 5),
            "screen.inbox is expected once Task 6 adds accessibility identifiers."
        )
    }
}
