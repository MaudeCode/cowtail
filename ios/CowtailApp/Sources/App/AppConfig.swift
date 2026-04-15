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
            let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            let url = URL(string: value),
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            fatalError("Missing required app config value for \(key)")
        }

        return url
    }
}
