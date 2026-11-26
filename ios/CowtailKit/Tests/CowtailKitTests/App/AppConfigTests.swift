import XCTest
@testable import CowtailKit

final class AppConfigTests: XCTestCase {
    /// The server routes preferences at `/api/me/notification-preferences`, next to the alerts API.
    func testNotificationPreferencesURLIsTheServerRouteBesideTheAlertsAPI() {
        XCTAssertEqual(
            AppConfig.notificationPreferencesURL.absoluteString,
            "https://convex-actions.example.com/api/me/notification-preferences"
        )
    }
}
