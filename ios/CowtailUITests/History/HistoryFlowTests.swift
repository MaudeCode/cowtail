import XCTest

@MainActor
final class HistoryFlowTests: XCTestCase {
    func testSelectingKindThroughNativePickerAppliesIt() {
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
    }
}
