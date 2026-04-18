import XCTest

@MainActor
final class RoundupFlowTests: XCTestCase {
    func testRoundupPopulatedShowsSummaryAndOutcomeSections() {
        let app = AppLaunching.configuredApp(
            scenario: "roundup_populated",
            startTab: "roundup"
        )

        app.launch()

        XCTAssertTrue(
            element(in: app, identifier: "screen.roundup").waitForExistence(timeout: 5),
            "The roundup screen should expose screen.roundup."
        )
        XCTAssertTrue(
            element(in: app, identifier: "card.roundup.summary").waitForExistence(timeout: 5),
            "The roundup summary card should expose card.roundup.summary."
        )
        XCTAssertTrue(
            element(in: app, identifier: "section.roundup.fixed").waitForExistence(timeout: 5),
            "The populated roundup scenario should expose a stable fixed outcome section identifier."
        )
        XCTAssertTrue(
            element(in: app, identifier: "section.roundup.self-resolved").waitForExistence(timeout: 5),
            "The populated roundup scenario should expose a stable self-resolved outcome section identifier."
        )
        XCTAssertTrue(
            element(in: app, identifier: "card.roundup.fixes").waitForExistence(timeout: 5),
            "The populated roundup scenario should expose card.roundup.fixes."
        )
    }

    func testRoundupEmptyShowsQuietDay() {
        let app = AppLaunching.configuredApp(
            scenario: "roundup_empty",
            startTab: "roundup"
        )

        app.launch()

        XCTAssertTrue(
            element(in: app, identifier: "screen.roundup").waitForExistence(timeout: 5),
            "The roundup screen should expose screen.roundup in the empty state too."
        )
        XCTAssertTrue(
            element(in: app, identifier: "card.roundup.quiet-day").waitForExistence(timeout: 5),
            "The empty roundup scenario should expose a stable quiet day card identifier."
        )
        XCTAssertTrue(
            element(in: app, identifier: "card.roundup.summary").waitForExistence(timeout: 5),
            "The roundup summary card should remain visible in the empty state."
        )
    }

    private func element(in app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
