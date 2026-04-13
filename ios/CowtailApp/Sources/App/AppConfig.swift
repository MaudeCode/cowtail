import Foundation

enum AppConfig {
    static let publicSiteURL = requiredURL("CowtailPublicSiteURL")
    static let convexQueryURL = requiredURL("CowtailConvexQueryURL")
    static let healthSummaryURL = requiredURL("CowtailHealthSummaryURL")
    static let alertWriteURL = requiredURL("CowtailAlertWriteURL")
    static let pushRegistrationURL = requiredURL("CowtailPushRegistrationURL")
    static let pushUnregistrationURL = requiredURL("CowtailPushUnregistrationURL")
    static let publicSiteHost = publicSiteURL.host?.lowercased() ?? ""

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

    private static func requiredURL(_ key: String) -> URL {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            let url = URL(string: value),
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            fatalError("Missing required app config value for \(key)")
        }

        return url
    }
}
