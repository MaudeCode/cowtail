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
        app.assertSections(["Platforms", "Cron", "Cron incidents", "Kanban", "Budget", "Recent answers"])
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
