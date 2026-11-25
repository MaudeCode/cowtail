import Foundation

enum AppConfig {
    static let publicSiteURL = requiredURL("CowtailPublicSiteURL")
    static let convexQueryURL = requiredURL("CowtailConvexQueryURL")
    static let healthSummaryURL = requiredURL("CowtailHealthSummaryURL")
    static let alertWriteURL = requiredURL("CowtailAlertWriteURL")
    static let authSessionURL = requiredURL("CowtailAuthSessionURL")
    static let notificationPreferencesURL = requiredURL("CowtailNotificationPreferencesURL")
    static let pushRegistrationURL = requiredURL("CowtailPushRegistrationURL")
    static let pushUnregistrationURL = requiredURL("CowtailPushUnregistrationURL")
    static let roundupTimeZoneIdentifier = requiredString("CowtailRoundupTimeZone")
    static let publicSiteHost = publicSiteURL.host?.lowercased() ?? ""
    static let alertAPIBaseURL = alertWriteURL.deletingLastPathComponent()
    static let oidcStartURL = alertAPIBaseURL.appendingPathComponent("auth/oidc/start")

    static func alertDetailURL(for alertID: String) -> URL? {
        let encodedID = alertID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? alertID
        return URL(string: "alerts/\(encodedID)", relativeTo: publicSiteURL)?.absoluteURL
    }

    static func resolvePublicURL(from string: String) -> URL? {
        if string.hasPrefix("/") {
            return URL(string: string, relativeTo: publicSiteURL)?.absoluteURL
        }

        return URL(string: string)
    }

    static func baseURL(for endpointURL: URL, droppingLastPathComponents count: Int) -> URL {
        precondition(count >= 0, "Path component count must be nonnegative")

        var result = endpointURL
        for _ in 0..<count {
            result.deleteLastPathComponent()
        }

        guard var components = URLComponents(url: result, resolvingAgainstBaseURL: false) else {
            return result
        }

        if components.path.count > 1, components.path.hasSuffix("/") {
            components.path.removeLast()
        }

        return components.url ?? result
    }

    private static func requiredURL(_ key: String) -> URL {
        guard
            let value = value(for: key),
            let url = URL(string: value),
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            fatalError("Missing required app config value for \(key)")
        }

        return url
    }

    private static func requiredString(_ key: String) -> String {
        guard
            let value = value(for: key),
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            fatalError("Missing required app config value for \(key)")
        }

        return value
    }

    /// The app reads its Info.plist, which `generate.sh` fills from `Config/project.env`. The package build, which
    /// only runs the tests, has no app Info.plist and reads the example values instead.
    private static func value(for key: String) -> String? {
        #if COWTAIL_PACKAGE
            [
                "CowtailPublicSiteURL": "https://cowtail.example.com",
                "CowtailConvexQueryURL": "https://convex-api.example.com/api/query",
                "CowtailHealthSummaryURL": "https://cowtail.example.com/actions/api/health",
                "CowtailAlertWriteURL": "https://convex-actions.example.com/api/alerts",
                "CowtailAuthSessionURL": "https://convex-actions.example.com/api/auth/session",
                "CowtailNotificationPreferencesURL": "https://convex-actions.example.com/api/me/notification-preferences",
                "CowtailPushRegistrationURL": "https://convex-actions.example.com/api/push/register",
                "CowtailPushUnregistrationURL": "https://convex-actions.example.com/api/push/unregister",
                "CowtailRoundupTimeZone": "America/New_York",
            ][key]
        #else
            Bundle.main.object(forInfoDictionaryKey: key) as? String
        #endif
    }
}
