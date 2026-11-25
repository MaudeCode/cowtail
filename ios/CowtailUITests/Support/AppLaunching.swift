import XCTest

enum AppLaunching {
    static func configuredApp(
        scenario: String,
        resetState: Bool = true,
        startTab: String? = nil,
        deepLinkURL: String? = nil
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["UI_TESTING"] = "1"
        app.launchEnvironment["UI_TEST_SCENARIO"] = scenario

        if resetState {
            app.launchEnvironment["UI_TEST_RESET_STATE"] = "1"
        }

        if let startTab, !startTab.isEmpty {
            app.launchEnvironment["UI_TEST_START_TAB"] = startTab
        }

        if let deepLinkURL, !deepLinkURL.isEmpty {
            app.launchEnvironment["UI_TEST_DEEP_LINK_URL"] = deepLinkURL
        }

        return app
    }
}

extension XCUIApplication {
    func element(_ identifier: String) -> XCUIElement {
        descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// Opens a handled item or incident, which only History lists, by searching History for a title.
    func openFromHistory(_ row: String, searching title: String, file: StaticString = #filePath, line: UInt = #line) {
        // The search field hides under the title until the list is pulled down.
        XCTAssertTrue(element("section.Outcomes").waitForExistence(timeout: 10), file: file, line: line)
        let search = searchFields.firstMatch
        if !search.isHittable {
            swipeDown(velocity: .slow)
        }
        XCTAssertTrue(search.waitForExistence(timeout: 10), file: file, line: line)
        search.tap()
        search.typeText(title)
        let match = element(row)
        XCTAssertTrue(match.waitForExistence(timeout: 10), row, file: file, line: line)
        match.tap()
    }

    /// A `List` builds only the rows on screen: scrolls down until the element is there and clear
    /// of the tab bar, or returns it missing for the caller's assertion. The caller first waits
    /// for the screen.
    func scrolledTo(_ identifier: String) -> XCUIElement {
        let target = element(identifier)
        for _ in 0..<6 where !(target.exists && target.isHittable) {
            swipeUp(velocity: .slow)
        }
        return target
    }

    /// Drags a row a third of its width toward `edge`, which shows its swipe actions without taking one.
    func revealSwipeActions(on row: XCUIElement, toward edge: SwipeEdge) {
        let (from, to): (CGFloat, CGFloat) = edge == .trailing ? (0.9, 0.55) : (0.1, 0.45)
        row.coordinate(withNormalizedOffset: CGVector(dx: from, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: to, dy: 0.5)))
    }

    /// Drags a row from its trailing edge across the screen: a full swipe.
    func fullSwipe(_ row: XCUIElement) {
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: -0.3, dy: 0.5)))
    }

    enum SwipeEdge {
        case leading, trailing
    }

    /// Fails unless every section header exists and they run top to bottom in this order.
    func assertSections(_ titles: [String], file: StaticString = #filePath, line: UInt = #line) {
        let tops = titles.map { title -> CGFloat in
            let header = element("section.\(title)")
            XCTAssertTrue(header.waitForExistence(timeout: 10), "Missing section \(title)", file: file, line: line)
            return header.frame.minY
        }
        XCTAssertEqual(tops, tops.sorted(), "Sections out of order: \(titles)", file: file, line: line)
    }
}
