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
