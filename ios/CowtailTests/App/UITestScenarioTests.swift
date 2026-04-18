import UserNotifications
import XCTest
@testable import Cowtail

final class UITestScenarioTests: XCTestCase {
    func testInboxPopulatedSeedIncludesAlertsHealthAndAuthorizedNotifications() {
        let scenario = UITestScenario(named: .inboxPopulated)
        let seed = scenario.seed

        XCTAssertEqual(ids(seed.store.alerts), ["preview-alert", "preview-alert-2"])
        XCTAssertEqual(seed.store.health?.cephStatus, "HEALTH_WARN")
        XCTAssertEqual(seed.notification.authorizationStatus, .authorized)
    }

    func testNotificationsPermissionDeniedSeedIncludesAppleIdentityAndDeniedNotifications() {
        let scenario = UITestScenario(named: .notificationsPermissionDenied)
        let seed = scenario.seed

        XCTAssertEqual(seed.apple.userID, "ui-test-apple-user")
        XCTAssertEqual(seed.notification.authorizationStatus, .denied)
        XCTAssertEqual(seed.notification.serverRegistrationState, .idle)
        XCTAssertFalse(seed.notification.dailyRoundupEnabled)
    }

    func testInboxPopulatedApiModeTranslatesToSeededSuccessPayload() {
        let seed = UITestScenario(named: .inboxPopulated).seed

        switch seed.apiMode {
        case let .success(alerts, health, fixesByAlertID, roundupAlerts, roundupFixes):
            XCTAssertEqual(ids(alerts), ids(seed.store.alerts))
            XCTAssertEqual(health.cephStatus, "HEALTH_WARN")
            XCTAssertEqual(fixesByAlertID[CowtailPreviewFixtures.alert.id], CowtailPreviewFixtures.fixes)
            XCTAssertEqual(ids(roundupAlerts), ids(seed.roundupAlerts))
            XCTAssertEqual(ids(roundupFixes), ids(seed.roundupFixes))
        case .alertListFailure:
            XCTFail("Expected success apiMode for inbox_populated")
        }
    }

    func testInboxErrorApiModeTranslatesToFailurePayload() async throws {
        let seed = UITestScenario(named: .inboxError).seed

        switch seed.apiMode {
        case let .alertListFailure(message, health):
            XCTAssertEqual(message, "Unable to load alerts from the seeded API.")
            XCTAssertEqual(health.cephStatus, "HEALTH_WARN")
        case .success:
            XCTFail("Expected alertListFailure apiMode for inbox_error")
        }

        let api = SeededCowtailAPI(mode: seed.apiMode)
        await XCTAssertThrowsCowtailAPIError(
            try await api.fetchAlerts(from: Date.distantPast, to: Date.distantFuture),
            expectedMessage: "Unable to load alerts from the seeded API."
        )
    }

    func testSeededCowtailAPIFetchesRoundupDataAndFindsAlertsAcrossInboxAndRoundup() async throws {
        let seed = UITestScenario(named: .inboxPopulated).seed
        let api = SeededCowtailAPI(mode: seed.apiMode)

        let roundupAlerts = try await api.fetchRoundupAlerts(from: Date.distantPast, to: Date.distantFuture)
        let roundupFixes = try await api.fetchRoundupFixes(from: Date.distantPast, to: Date.distantFuture)
        let inboxAlert = try await api.fetchAlert(id: CowtailPreviewFixtures.alert.id)
        let roundupAlert = try await api.fetchAlert(id: "roundup-alert-1")

        XCTAssertEqual(ids(roundupAlerts), ids(seed.roundupAlerts))
        XCTAssertEqual(ids(roundupFixes), ids(seed.roundupFixes))
        XCTAssertEqual(inboxAlert?.id, CowtailPreviewFixtures.alert.id)
        XCTAssertEqual(roundupAlert?.id, "roundup-alert-1")
    }
}

private func ids(_ alerts: [AlertItem]) -> [String] {
    alerts.map { $0.id }
}

private func ids(_ fixes: [AlertFix]) -> [String] {
    fixes.map { $0.id }
}

private func XCTAssertThrowsCowtailAPIError<T>(
    _ expression: @autoclosure () async throws -> T,
    expectedMessage: String,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected CowtailAPIError.requestFailed", file: file, line: line)
    } catch let error as CowtailAPIError {
        switch error {
        case .requestFailed(let message):
            XCTAssertEqual(message, expectedMessage, file: file, line: line)
        }
    } catch {
        XCTFail("Expected CowtailAPIError but got \(error)", file: file, line: line)
    }
}
