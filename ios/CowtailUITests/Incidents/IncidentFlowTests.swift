import XCTest

@MainActor
final class IncidentFlowTests: XCTestCase {
    private func launchIncidents() -> XCUIApplication {
        let app = AppLaunching.configuredApp(scenario: "inbox_incidents")
        app.launch()
        return app
    }

    func testAnIncidentIsOneRowInNeedsYouThatOpensItsDetail() {
        let app = launchIncidents()

        let row = app.element("row.incident.incident-storage")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("Storage outage"), row.label)
        XCTAssertTrue(row.label.contains("Incident · 2 items · now · 47m"), row.label)
        XCTAssertLessThan(app.element("section.Needs you").frame.minY, row.frame.minY)
        XCTAssertLessThan(row.frame.maxY, app.element("section.Hermes is on it").frame.minY)
        XCTAssertFalse(app.element("row.item.alert-osddown").exists)
        row.tap()

        XCTAssertTrue(app.element("screen.incident-detail").waitForExistence(timeout: 10))
        app.assertSections(["Timeline", "Postmortem", "Members"])
        XCTAssertTrue(app.element("event.item_added").exists)
        for button in ["Add an item", "Request postmortem again", "Resolve"] {
            XCTAssertTrue(app.buttons[button].exists, button)
        }
        XCTAssertFalse(app.buttons["Request postmortem again"].isEnabled)
        XCTAssertTrue(app.element("row.member.alert-osddown").exists)
        XCTAssertTrue(app.element("row.member.alert-cephhealtherr").exists)
    }

    func testAResolvedIncidentShowsHermessPostmortem() {
        let app = AppLaunching.configuredApp(scenario: "inbox_incidents", startTab: "history")
        app.launch()

        app.openFromHistory("row.incident.incident-media", searching: "OOMKilled")

        let postmortem = app.element("text.incident.postmortem")
        XCTAssertTrue(postmortem.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Follow-ups"].exists)
        XCTAssertTrue(app.staticTexts["Raise the transcoder's memory limit"].exists)
        XCTAssertTrue(app.element("event.postmortem_written").exists)
        XCTAssertFalse(app.buttons["Resolve"].exists)
    }

    func testRemoveFromIncidentTakesTheMemberOut() {
        let app = launchIncidents()

        let row = app.element("row.incident.incident-storage")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        let remove = app.buttons["button.incident.remove.alert-cephhealtherr"]
        XCTAssertTrue(remove.waitForExistence(timeout: 10))
        XCTAssertEqual(remove.label, "Remove from incident")
        remove.tap()

        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.element("row.member.alert-cephhealtherr"))
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.element("row.member.alert-osddown").exists)
    }

    func testAnItemInAnIncidentLinksToIt() {
        let app = AppLaunching.configuredApp(scenario: "inbox_incidents", startTab: "history")
        app.launch()

        let row = app.element("row.incident.incident-storage")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        let member = app.element("link.member.alert-osddown")
        XCTAssertTrue(member.waitForExistence(timeout: 10))
        member.tap()

        let chip = app.element("chip.item.incident")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Open incident Storage outage")
    }
}
