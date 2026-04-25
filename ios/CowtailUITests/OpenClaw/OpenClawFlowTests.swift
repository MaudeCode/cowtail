import XCTest

@MainActor
final class OpenClawFlowTests: XCTestCase {
    func testOpenClawTabShowsSeededDisplayNameAndThreads() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.threads").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["row.openclaw.thread.preview-thread"].waitForExistence(timeout: 5))
    }

    func testCanOpenThreadDetail() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))
    }

    func testSignedOutStateAppears() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_signed_out")
        app.launch()

        app.tabBars.buttons["OpenClaw"].tap()

        XCTAssertTrue(element(in: app, identifier: "card.openclaw.signed-out").waitForExistence(timeout: 5))
    }

    private func element(in app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
