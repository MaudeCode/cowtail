import Foundation

struct AppLaunchConfiguration: Equatable {
    enum Mode: Equatable {
        case normal
        case uiTesting(UITestScenario.Name)
    }

    let mode: Mode
    let resetPersistentState: Bool
    let deepLinkURL: URL?
    let selectedTab: AppTab?

    static func current(processInfo: ProcessInfo = .processInfo) -> AppLaunchConfiguration {
        make(environment: processInfo.environment, arguments: processInfo.arguments)
    }

    static func make(environment: [String: String], arguments _: [String]) -> AppLaunchConfiguration {
        guard environment["UI_TESTING"] == "1" else {
            return AppLaunchConfiguration(
                mode: .normal,
                resetPersistentState: false,
                deepLinkURL: nil,
                selectedTab: nil
            )
        }

        let scenario = UITestScenario.Name(
            rawValue: normalizedValue(for: environment["UI_TEST_SCENARIO"])
        ) ?? .inboxPopulated

        return AppLaunchConfiguration(
            mode: .uiTesting(scenario),
            resetPersistentState: environment["UI_TEST_RESET_STATE"] == "1",
            deepLinkURL: normalizedURL(for: environment["UI_TEST_DEEP_LINK_URL"]),
            selectedTab: selectedTab(from: environment["UI_TEST_START_TAB"])
        )
    }

    private static func normalizedValue(for value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func normalizedURL(for value: String?) -> URL? {
        let normalized = normalizedValue(for: value)
        guard !normalized.isEmpty else {
            return nil
        }

        return URL(string: normalized)
    }

    private static func selectedTab(from value: String?) -> AppTab? {
        switch normalizedValue(for: value).lowercased() {
        case "inbox":
            return .inbox
        case "roundup":
            return .roundup
        case "farmhouse":
            return .farmhouse
        default:
            return nil
        }
    }
}
