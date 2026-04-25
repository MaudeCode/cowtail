import UserNotifications
import XCTest
@testable import Cowtail

final class UITestScenarioTests: XCTestCase {
    @MainActor
    func testOpenClawNotificationRoutesToThreadDetail() {
        let router = UniversalLinkRouter.makeForTesting()

        let handled = router.handleNotification(userInfo: [
            "kind": "openclaw",
            "threadId": "thread-1",
            "messageId": "message-1",
        ])

        XCTAssertTrue(handled)
        XCTAssertEqual(router.selectedTab, .openclaw)
        XCTAssertEqual(router.openClawPath, [.thread("thread-1")])
    }

    @MainActor
    func testAppRuntimeSeedsManagersAndStartupTabForUITesting() {
        AppleAccountManager.shared.seedForUITesting(
            signInState: .signedOut,
            userID: "stale-user",
            identityToken: "stale-token",
            displayName: "Stale User",
            email: "stale@example.com",
            lastError: "stale-apple-error"
        )
        AppSessionManager.shared.seedForUITesting(
            sessionState: .failed,
            token: "stale-session-token",
            userID: "stale-user",
            expiresAt: Date.distantPast,
            lastError: "stale-session-error"
        )
        NotificationManager.shared.seedForUITesting(
            authorizationStatus: .denied,
            registrationState: .failed,
            serverRegistrationState: .failed,
            deviceToken: "stale-device-token",
            registrationError: "stale-registration-error",
            serverRegistrationMessage: "stale-server-message",
            dailyRoundupEnabled: false,
            dailyRoundupPreferenceRequiresSignIn: true,
            dailyRoundupPreferenceError: "stale-preference-error"
        )
        UniversalLinkRouter.shared.applyUITestStartupSelection(
            selectedTab: .roundup,
            deepLinkURL: URL(string: "https://example.com/alerts/stale-alert")
        )

        let runtime = AppRuntime.make(
            configuration: .init(
                mode: .uiTesting(.notificationsReady),
                resetPersistentState: true,
                deepLinkURL: nil,
                selectedTab: .farmhouse
            )
        )

        XCTAssertTrue(runtime.appleAccountManager === AppleAccountManager.shared)
        XCTAssertTrue(runtime.appSessionManager === AppSessionManager.shared)
        XCTAssertTrue(runtime.notificationManager === NotificationManager.shared)
        XCTAssertTrue(runtime.universalLinkRouter === UniversalLinkRouter.shared)
        XCTAssertEqual(runtime.appleAccountManager.signInState, .signedIn)
        XCTAssertEqual(runtime.appleAccountManager.userID, "ui-test-apple-user")
        XCTAssertEqual(runtime.appleAccountManager.identityToken, "ui-test-identity-token")
        XCTAssertEqual(runtime.appSessionManager.sessionState, .ready)
        XCTAssertEqual(runtime.appSessionManager.validSessionToken(), "ui-test-session-token")
        XCTAssertEqual(runtime.notificationManager.authorizationStatus, .authorized)
        XCTAssertEqual(runtime.notificationManager.registrationState, .registered)
        XCTAssertEqual(runtime.notificationManager.serverRegistrationState, .registered)
        XCTAssertEqual(runtime.notificationManager.deviceToken, "ui-test-device-token")
        XCTAssertTrue(runtime.notificationManager.dailyRoundupEnabled)
        XCTAssertEqual(runtime.universalLinkRouter.selectedTab, .farmhouse)
        XCTAssertTrue(runtime.universalLinkRouter.inboxPath.isEmpty)
    }

    @MainActor
    func testAppRuntimePreloadsSeededStoreWithoutImmediateRefresh() async {
        let runtime = AppRuntime.make(
            configuration: .init(
                mode: .uiTesting(.inboxPopulated),
                resetPersistentState: true,
                deepLinkURL: nil,
                selectedTab: nil
            )
        )
        let seed = UITestScenario(named: .inboxPopulated).seed

        XCTAssertEqual(ids(runtime.cowtailStore.alerts), ids(seed.store.alerts))
        XCTAssertEqual(runtime.cowtailStore.health?.cephStatus, "HEALTH_WARN")
        XCTAssertEqual(runtime.cowtailStore.fixesByAlertID[CowtailPreviewFixtures.alert.id], CowtailPreviewFixtures.fixes)
        XCTAssertNil(runtime.cowtailStore.lastUpdated)
        XCTAssertFalse(runtime.cowtailStore.isLoading)

        await runtime.cowtailStore.loadIfNeeded()

        XCTAssertEqual(ids(runtime.cowtailStore.alerts), ids(seed.store.alerts))
        XCTAssertEqual(runtime.cowtailStore.health?.cephStatus, "HEALTH_WARN")
        XCTAssertNil(runtime.cowtailStore.lastUpdated)
        XCTAssertFalse(runtime.cowtailStore.isLoading)
    }

    @MainActor
    func testUITestRuntimeManagerRefreshMethodsPreserveSeededState() async {
        let runtime = AppRuntime.make(
            configuration: .init(
                mode: .uiTesting(.notificationsReady),
                resetPersistentState: true,
                deepLinkURL: nil,
                selectedTab: .farmhouse
            )
        )

        let initialAppleState = AppleManagerSnapshot(manager: runtime.appleAccountManager)
        let initialSessionState = SessionManagerSnapshot(manager: runtime.appSessionManager)
        let initialNotificationState = NotificationManagerSnapshot(manager: runtime.notificationManager)

        await runtime.appleAccountManager.refreshCredentialState()
        _ = await runtime.appSessionManager.refreshSessionIfPossible()
        await runtime.notificationManager.refreshAuthorizationStatus()
        runtime.notificationManager.resumeNotificationSetupIfNeeded()
        await runtime.notificationManager.syncDeviceRegistration()
        await runtime.notificationManager.loadDailyRoundupPreference()

        XCTAssertEqual(AppleManagerSnapshot(manager: runtime.appleAccountManager), initialAppleState)
        XCTAssertEqual(SessionManagerSnapshot(manager: runtime.appSessionManager), initialSessionState)
        XCTAssertEqual(NotificationManagerSnapshot(manager: runtime.notificationManager), initialNotificationState)
    }

    func testInboxPopulatedSeedIncludesAlertsHealthAndAuthorizedNotifications() {
        let scenario = UITestScenario(named: .inboxPopulated)
        let seed = scenario.seed

        XCTAssertEqual(
            ids(seed.store.alerts),
            ["preview-alert", "preview-alert-3", "preview-alert-4", "preview-alert-5", "preview-alert-2"]
        )
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

private struct AppleManagerSnapshot: Equatable {
    let signInState: AppleAccountManager.SignInState
    let userID: String?
    let identityToken: String?
    let displayName: String?
    let email: String?
    let lastError: String?

    @MainActor
    init(manager: AppleAccountManager) {
        signInState = manager.signInState
        userID = manager.userID
        identityToken = manager.identityToken
        displayName = manager.displayName
        email = manager.email
        lastError = manager.lastError
    }
}

private struct SessionManagerSnapshot: Equatable {
    let sessionState: AppSessionManager.SessionState
    let token: String?
    let userID: String?
    let expiresAt: Date?
    let lastError: String?

    @MainActor
    init(manager: AppSessionManager) {
        sessionState = manager.sessionState
        token = manager.validSessionToken()
        userID = manager.userID
        expiresAt = manager.expiresAt
        lastError = manager.lastError
    }
}

private struct NotificationManagerSnapshot: Equatable {
    let authorizationStatus: UNAuthorizationStatus
    let registrationState: NotificationManager.RegistrationState
    let serverRegistrationState: NotificationManager.ServerRegistrationState
    let deviceToken: String?
    let registrationError: String?
    let serverRegistrationMessage: String?
    let dailyRoundupEnabled: Bool
    let dailyRoundupPreferenceRequiresSignIn: Bool
    let dailyRoundupPreferenceError: String?

    @MainActor
    init(manager: NotificationManager) {
        authorizationStatus = manager.authorizationStatus
        registrationState = manager.registrationState
        serverRegistrationState = manager.serverRegistrationState
        deviceToken = manager.deviceToken
        registrationError = manager.registrationError
        serverRegistrationMessage = manager.serverRegistrationMessage
        dailyRoundupEnabled = manager.dailyRoundupEnabled
        dailyRoundupPreferenceRequiresSignIn = manager.dailyRoundupPreferenceRequiresSignIn
        dailyRoundupPreferenceError = manager.dailyRoundupPreferenceError
    }
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
