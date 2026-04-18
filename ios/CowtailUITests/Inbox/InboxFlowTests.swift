import XCTest

final class InboxFlowTests: XCTestCase {
    func testInboxPopulatedRendersInboxScreen() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")

        app.launch()

        XCTAssertTrue(app.otherElements["screen.inbox"].waitForExistence(timeout: 5))
    }
}
