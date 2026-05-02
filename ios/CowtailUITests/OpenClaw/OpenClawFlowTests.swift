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

    func testCanFocusAndTypeInThreadComposer() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        let composer = element(in: app, identifier: "field.openclaw.reply")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))

        composer.tap()
        composer.typeText("Check rollout")

        XCTAssertTrue(app.buttons["button.openclaw.send-reply"].isEnabled)
    }

    func testBackFromThreadDetailReturnsToThreadList() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let firstThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        let secondThreadRow = app.buttons["row.openclaw.thread.preview-thread-2"]
        XCTAssertTrue(firstThreadRow.waitForExistence(timeout: 5))
        XCTAssertTrue(secondThreadRow.waitForExistence(timeout: 5))

        firstThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        app.navigationBars.buttons.element(boundBy: 0).tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.threads").waitForExistence(timeout: 5))
        XCTAssertTrue(firstThreadRow.waitForExistence(timeout: 5))
        XCTAssertTrue(secondThreadRow.waitForExistence(timeout: 5))
        XCTAssertFalse(element(in: app, identifier: "screen.openclaw.thread-detail").exists)
    }

    func testThreadDetailExposesRenameAndDeleteActions() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        app.buttons["button.openclaw.thread-actions"].tap()

        XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Delete"].exists)
    }

    func testThreadDetailShowsExpandableToolCalls() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        let toolCall = app.buttons["Tool call query_metrics"].firstMatch
        XCTAssertTrue(toolCall.waitForExistence(timeout: 5))
        toolCall.tap()

        XCTAssertTrue(app.staticTexts["Input"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Output"].exists)
        XCTAssertTrue(app.staticTexts["p95 latency is elevated on node-a and node-c."].exists)
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
