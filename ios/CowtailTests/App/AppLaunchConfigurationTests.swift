import XCTest
@testable import Cowtail

@MainActor
final class AppLaunchConfigurationTests: XCTestCase {
    func testMakeDefaultsToNormalRuntimeWhenUITestingFlagIsAbsent() {
        let configuration = AppLaunchConfiguration.make(environment: [:], arguments: [])

        XCTAssertEqual(
            configuration,
            AppLaunchConfiguration(
                mode: .normal,
                resetPersistentState: false,
                deepLinkURL: nil,
                selectedTab: nil
            )
        )
    }

    func testMakeParsesUITestingScenarioResetFlagDeepLinkAndStartTab() throws {
        let environment: [String: String] = [
            "UI_TESTING": "1",
            "UI_TEST_SCENARIO": "inboxPopulated",
            "UI_TEST_RESET_STATE": "1",
            "UI_TEST_DEEP_LINK_URL": "https://example.com/roundup?from=2026-04-10&to=2026-04-11",
            "UI_TEST_START_TAB": "farmhouse"
        ]

        let configuration = AppLaunchConfiguration.make(environment: environment, arguments: [])

        XCTAssertEqual(
            configuration,
            AppLaunchConfiguration(
                mode: .uiTesting(.inboxPopulated),
                resetPersistentState: true,
                deepLinkURL: try XCTUnwrap(URL(string: "https://example.com/roundup?from=2026-04-10&to=2026-04-11")),
                selectedTab: .farmhouse
            )
        )
    }
}
