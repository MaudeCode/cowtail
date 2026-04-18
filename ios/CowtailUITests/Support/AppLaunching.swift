import XCTest

enum AppLaunching {
    static func configuredApp(
        scenario: String,
        startTab: String? = nil,
        deepLinkURL: String? = nil
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["UI_TESTING"] = "1"
        app.launchEnvironment["UI_TEST_SCENARIO"] = scenario
        app.launchEnvironment["UI_TEST_RESET_STATE"] = "1"

        if let startTab, !startTab.isEmpty {
            app.launchEnvironment["UI_TEST_START_TAB"] = startTab
        }

        if let deepLinkURL, !deepLinkURL.isEmpty {
            app.launchEnvironment["UI_TEST_DEEP_LINK_URL"] = deepLinkURL
        }

        return app
    }
}
