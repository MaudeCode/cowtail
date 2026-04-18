import UserNotifications
import XCTest
@testable import Cowtail

final class UITestScenarioTests: XCTestCase {
    func testInboxPopulatedSeedIncludesAlertsHealthAndAuthorizedNotifications() throws {
        let scenario = try XCTUnwrap(UITestScenario(named: .inboxPopulated))
        let seed = scenario.seed

        XCTAssertEqual(seed.store.alerts.map(\.id), ["preview-alert", "preview-alert-2"])
        XCTAssertEqual(seed.store.health?.cephStatus, "HEALTH_WARN")
        XCTAssertEqual(seed.notification.authorizationStatus, .authorized)
    }

    func testNotificationsPermissionDeniedSeedIncludesAppleIdentityAndDeniedNotifications() throws {
        let scenario = try XCTUnwrap(UITestScenario(named: .notificationsPermissionDenied))
        let seed = scenario.seed

        XCTAssertEqual(seed.apple.userID, "ui-test-apple-user")
        XCTAssertEqual(seed.notification.authorizationStatus, .denied)
        XCTAssertEqual(seed.notification.serverRegistrationState, .idle)
        XCTAssertFalse(seed.notification.dailyRoundupEnabled)
    }
}
