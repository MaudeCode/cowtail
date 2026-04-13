import Foundation

enum AppTab: Hashable {
    case inbox
    case settings
}

enum InboxRoute: Hashable {
    case alert(String)
}

@MainActor
final class UniversalLinkRouter: ObservableObject {
    static let shared = UniversalLinkRouter()

    @Published var selectedTab: AppTab = .inbox
    @Published var inboxPath: [InboxRoute] = []

    private init() {}

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard
            url.scheme?.lowercased() == "https",
            url.host?.lowercased() == AppConfig.publicSiteHost
        else {
            return false
        }

        let pathComponents = url.path
            .split(separator: "/")
            .map(String.init)

        switch pathComponents {
        case []:
            openInbox()
        case ["digest"], ["fixes"]:
            openInbox()
        case let components where components.count == 2 && components[0] == "alerts":
            let alertID = components[1]
            openAlert(alertID.removingPercentEncoding ?? alertID)
        default:
            return false
        }

        return true
    }

    @discardableResult
    func handleNotification(userInfo: [AnyHashable: Any]) -> Bool {
        if let urlString = stringValue(
            for: ["url", "link", "deepLinkURL", "deepLinkUrl", "deep_link_url"],
            in: userInfo
        ), let url = resolvedURL(from: urlString) {
            return handle(url)
        }

        if let alertID = stringValue(for: ["alertId", "alertID", "alert_id"], in: userInfo) {
            openAlert(alertID)
            return true
        }

        return false
    }

    @discardableResult
    func handleNotification(urlString: String?, alertID: String?) -> Bool {
        if let urlString, let url = resolvedURL(from: urlString) {
            return handle(url)
        }

        if let alertID {
            openAlert(alertID)
            return true
        }

        return false
    }

    func openInbox() {
        selectedTab = .inbox
        inboxPath.removeAll()
    }

    func openAlert(_ alertID: String) {
        let trimmedAlertID = alertID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedAlertID.isEmpty else {
            return
        }

        selectedTab = .inbox
        inboxPath.removeAll()
        inboxPath = [.alert(trimmedAlertID)]
    }

    private func stringValue(for keys: [String], in userInfo: [AnyHashable: Any]) -> String? {
        for key in keys {
            if let string = userInfo[key] as? String {
                let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }

        return nil
    }

    private func resolvedURL(from string: String) -> URL? {
        AppConfig.resolvePublicURL(from: string)
    }
}
