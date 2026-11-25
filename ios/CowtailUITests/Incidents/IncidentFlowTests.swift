import XCTest

@MainActor
final class IncidentFlowTests: XCTestCase {
    private func launchIncidents() -> XCUIApplication {
        let app = AppLaunching.configuredApp(scenario: "inbox_incidents")
        app.launch()
        return app
    }

    func testRemoveFromIncidentTakesTheMemberOut() {
        let app = launchIncidents()

        let row = app.element("row.incident.incident-storage")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        XCTAssertTrue(app.element("section.Members").waitForExistence(timeout: 10))
        let member = app.scrolledTo("row.item.alert-cephhealtherr")
        XCTAssertTrue(member.exists)
        member.press(forDuration: 1.2)
        let remove = app.buttons["Remove from incident"]
        XCTAssertTrue(remove.waitForExistence(timeout: 10))
        remove.tap()

        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: member)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.element("row.item.alert-osddown").exists)
    }
}
