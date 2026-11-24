import XCTest

@MainActor
final class HermesFlowTests: XCTestCase {
    func testHermesShowsItsHeaderThenItsSectionsInTheFiguresOrder() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "hermes")
        app.launch()

        let heartbeat = app.element("chip.hermes.heartbeat")
        XCTAssertTrue(heartbeat.waitForExistence(timeout: 10))
        let model = app.element("text.hermes.model")
        XCTAssertEqual(model.label, "opus-5.5 · anthropic")
        XCTAssertLessThan(model.frame.minY, app.element("section.Platforms").frame.minY)
        app.assertSections([
            "Platforms", "Cron", "Cron incidents", "Kanban", "Budget",
            "Runbook · services", "Runbook · diagnostics", "Run · Restart script runner", "Recent answers",
        ])
    }

    func testARunbookScriptShowsItsPromptThenTheNewRunsOutput() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "hermes")
        app.launch()

        let run = app.element("button.runbook.gateway-restart")
        XCTAssertTrue(run.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Asks to confirm"].exists)
        run.tap()

        let prompt = app.alerts["Restart Hermes gateway"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 10))
        XCTAssertTrue(prompt.staticTexts["Restart the Hermes gateway?"].exists)
        prompt.buttons["Run"].tap()

        XCTAssertTrue(app.element("section.Run · Restart Hermes gateway").waitForExistence(timeout: 10))
        let output = app.element("text.run.output")
        XCTAssertTrue(output.waitForExistence(timeout: 10))
        XCTAssertTrue(output.label.contains("/dev/nvme0n1p2  916G"), output.label)
        XCTAssertTrue(app.element("row.hermes.run.run-3").exists)
    }

    func testACronIncidentOpensItsItem() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "hermes")
        app.launch()

        let incident = app.element("row.hermes.incident.backup-verify-sig")
        XCTAssertTrue(incident.waitForExistence(timeout: 10))
        incident.tap()

        XCTAssertTrue(app.element("screen.item-detail").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Nightly backup verify failed"].exists)
    }
}
