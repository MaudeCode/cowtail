import XCTest

@MainActor
final class HistoryFlowTests: XCTestCase {
    func testHistoryShowsItsStatsInTheFiguresOrderBehindANamedFilterButton() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "history")
        app.launch()

        let filter = app.buttons["button.history.filter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 10))
        XCTAssertEqual(filter.label, "Filter")
        app.assertSections(["Outcomes", "Time to resolve"])
        XCTAssertTrue(app.element("row.history.noise-rate").exists)
    }

    func testAFilterShowsAsAChipAndRemovingTheChipClearsIt() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "history")
        app.launch()

        let filter = app.buttons["button.history.filter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 10))
        filter.tap()
        let kind = app.buttons["picker.history.kind"]
        XCTAssertTrue(kind.waitForExistence(timeout: 10))
        kind.tap()
        let approval = app.buttons["approval"]
        XCTAssertTrue(approval.waitForExistence(timeout: 10))
        approval.tap()
        app.buttons["button.history.filter-done"].tap()

        let chip = app.buttons["chip.history.kind"]
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Remove filter approval")
        let other = app.element("row.item.alert-crashloop")
        let filtered = NSPredicate { _, _ in !other.exists }
        expectation(for: filtered, evaluatedWith: nil)
        waitForExpectations(timeout: 10)

        chip.tap()

        XCTAssertTrue(app.scrolledTo("row.item.alert-crashloop").exists)
        XCTAssertFalse(app.buttons["chip.history.kind"].exists)
    }

    func testTheRoundupRowOpensTheRoundup() {
        let app = AppLaunching.configuredApp(scenario: "roundup_populated", startTab: "history")
        app.launch()

        let roundup = app.element("row.history.roundup")
        XCTAssertTrue(roundup.waitForExistence(timeout: 10))
        roundup.tap()

        XCTAssertTrue(app.element("screen.roundup").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("card.roundup.summary").waitForExistence(timeout: 10))
    }
}
