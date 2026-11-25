import UserNotifications
import XCTest
@testable import CowtailKit

final class UITestScenarioTests: XCTestCase {
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
            preferences: AppNotificationPreferences(),
            dailyRoundupPreferenceRequiresSignIn: true,
            dailyRoundupPreferenceError: "stale-preference-error"
        )
        UniversalLinkRouter.shared.applyUITestStartupSelection(
            selectedTab: .history,
            deepLinkURL: URL(string: "https://example.com/alerts/stale-alert")
        )

        let runtime = AppRuntime.make(
            configuration: .init(
                mode: .uiTesting(.notificationsReady),
                resetPersistentState: true,
                deepLinkURL: nil,
                selectedTab: .settings
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
        // Settings is no tab: its launch value opens it on Inbox.
        XCTAssertEqual(runtime.universalLinkRouter.selectedTab, .inbox)
        XCTAssertEqual(runtime.universalLinkRouter.inboxPath, [.settings])
    }

    @MainActor
    func testUITestRuntimeManagerRefreshMethodsPreserveSeededState() async {
        let runtime = AppRuntime.make(
            configuration: .init(
                mode: .uiTesting(.notificationsReady),
                resetPersistentState: true,
                deepLinkURL: nil,
                selectedTab: .settings
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
    let preferences: AppNotificationPreferences
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
        preferences = manager.preferences
        dailyRoundupPreferenceRequiresSignIn = manager.dailyRoundupPreferenceRequiresSignIn
        dailyRoundupPreferenceError = manager.dailyRoundupPreferenceError
    }
}
