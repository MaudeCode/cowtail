import Foundation

enum AppTab: Hashable {
    case inbox
    case roundup
    case farmhouse
}

enum InboxRoute: Hashable {
    case alert(String)
    case roundup(RoundupRoute)
}

struct RoundupRoute: Hashable {
    let from: String
    let to: String
}

@MainActor
final class UniversalLinkRouter: ObservableObject {
    static let shared = UniversalLinkRouter()

    @Published var selectedTab: AppTab = .inbox
    @Published var inboxPath: [InboxRoute] = []
    @Published var roundupRoute: RoundupRoute

    private init() {
        self.roundupRoute = Self.makeDefaultRoundupRoute()
    }

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
        case ["digest"]:
            openRoundup(resolveRoundupRoute(from: url))
        case ["fixes"]:
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

    func openRoundup(_ roundupRoute: RoundupRoute) {
        selectedTab = .roundup
        self.roundupRoute = roundupRoute
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

    private func resolveRoundupRoute(from url: URL) -> RoundupRoute {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return defaultRoundupRoute()
        }

        let defaultRoute = defaultRoundupRoute()
        let from = firstNonEmptyQueryValue(named: "from", in: components.queryItems)
        let to = firstNonEmptyQueryValue(named: "to", in: components.queryItems)

        return RoundupRoute(
            from: (from?.isEmpty == false ? from : nil) ?? to ?? defaultRoute.from,
            to: (to?.isEmpty == false ? to : nil) ?? from ?? defaultRoute.to
        )
    }

    private func defaultRoundupRoute() -> RoundupRoute {
        Self.makeDefaultRoundupRoute()
    }

    private static func makeDefaultRoundupRoute() -> RoundupRoute {
        let timeZone = TimeZone(identifier: AppConfig.digestTimeZoneIdentifier) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        let now = Date()
        let todayStart = calendar.startOfDay(for: now)
        let roundupDate = calendar.date(byAdding: .day, value: -1, to: todayStart) ?? now

        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let dateString = formatter.string(from: roundupDate)

        return RoundupRoute(from: dateString, to: dateString)
    }

    private func firstNonEmptyQueryValue(named name: String, in queryItems: [URLQueryItem]?) -> String? {
        for item in queryItems ?? [] where item.name == name {
            guard let value = item.value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty else {
                continue
            }

            return value
        }

        return nil
    }
}
