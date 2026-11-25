import AuthenticationServices
import Foundation
import UserNotifications

struct UITestScenario {
    enum Name: String, CaseIterable, Equatable {
        case inboxPopulated = "inbox_populated"
        case inboxMaintenance = "inbox_maintenance"
        case inboxIncidents = "inbox_incidents"
        case inboxEmpty = "inbox_empty"
        case inboxError = "inbox_error"
        case inboxCachedOffline = "inbox_cached_offline"
        case roundupPopulated = "roundup_populated"
        case roundupEmpty = "roundup_empty"
        case alertDeepLinkKnown = "alert_deep_link_known"
        case alertDeepLinkMissing = "alert_deep_link_missing"
        case signedOut = "signed_out"
        case notificationsPermissionDenied = "notifications_permission_denied"
        case notificationsReady = "notifications_ready"
        case notificationsSyncError = "notifications_sync_error"
        case signedOutWithOIDC = "signed_out_with_oidc"
        case signedInWithOIDC = "signed_in_with_oidc"
    }

    struct Seed {
        let server: SeededCowtailAPI.Seed
        let apple: AppleSeed
        let session: SessionSeed
        let notification: NotificationSeed
    }

    struct AppleSeed {
        let signInState: AppleAccountManager.SignInState
        let userID: String?
        let identityToken: String?
        let displayName: String?
        let email: String?
        let lastError: String?
    }

    struct SessionSeed {
        let sessionState: AppSessionManager.SessionState
        let token: String?
        let userID: String?
        let expiresAt: Date?
        let lastError: String?
        let provider: String?
    }

    struct NotificationSeed {
        let authorizationStatus: UNAuthorizationStatus
        let registrationState: NotificationManager.RegistrationState
        let serverRegistrationState: NotificationManager.ServerRegistrationState
        let deviceToken: String?
        let registrationError: String?
        let serverRegistrationMessage: String?
        let preferences: AppNotificationPreferences
        let dailyRoundupPreferenceRequiresSignIn: Bool
        let dailyRoundupPreferenceError: String?
    }

    let name: Name
    let seed: Seed

    init(named name: Name) {
        self.name = name
        self.seed = SeedFactory.makeSeed(for: name)
    }
}

private enum SeedFactory {
    private static let signedInApple = UITestScenario.AppleSeed(
        signInState: .signedIn,
        userID: "ui-test-apple-user",
        identityToken: "ui-test-identity-token",
        displayName: "UI Test User",
        email: "ui-test@example.com",
        lastError: nil
    )

    private static let signedOutApple = UITestScenario.AppleSeed(
        signInState: .signedOut,
        userID: nil,
        identityToken: nil,
        displayName: nil,
        email: nil,
        lastError: nil
    )

    private static let readySession = UITestScenario.SessionSeed(
        sessionState: .ready,
        token: "ui-test-session-token",
        userID: "ui-test-apple-user",
        expiresAt: .now.addingTimeInterval(60 * 60),
        lastError: nil,
        provider: AppSessionManager.appleProvider
    )

    private static let idleSession = UITestScenario.SessionSeed(
        sessionState: .idle,
        token: nil,
        userID: nil,
        expiresAt: nil,
        lastError: nil,
        provider: nil
    )

    private static let pocketIDServer = SeededCowtailAPI.Seed(oidcProviderName: "Pocket ID")

    /// Signed out: push and preferences wait for a sign-in.
    private static let signedOutNotification = UITestScenario.NotificationSeed(
        authorizationStatus: .notDetermined,
        registrationState: .idle,
        serverRegistrationState: .waitingForIdentity,
        deviceToken: nil,
        registrationError: nil,
        serverRegistrationMessage: "Sign in to attach this device token to a Cowtail identity.",
        preferences: AppNotificationPreferences(),
        dailyRoundupPreferenceRequiresSignIn: true,
        dailyRoundupPreferenceError: nil
    )

    private static let connectedNotification = UITestScenario.NotificationSeed(
        authorizationStatus: .authorized,
        registrationState: .registered,
        serverRegistrationState: .registered,
        deviceToken: "ui-test-device-token",
        registrationError: nil,
        serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
        preferences: ownerPreferences,
        dailyRoundupPreferenceRequiresSignIn: false,
        dailyRoundupPreferenceError: nil
    )

    private static let ownerPreferences = AppNotificationPreferences(
        dailyRoundupEnabled: true,
        requireAuthForApprovals: true,
        quietHours: QuietHours(start: "22:00", end: "07:30", timeZone: TimeZone.current.identifier),
        urgencyOverrides: ["factory": .whenever, "hermes:failure": .now, "deployer:done": .whenever],
        urgencyOverrideOrder: ["deployer:done", "factory", "hermes:failure"]
    )

    private static let scenarioDefaults = UITestScenario.Seed(
        server: SeededCowtailAPI.Seed(),
        apple: signedInApple,
        session: readySession,
        notification: connectedNotification
    )

    static func makeSeed(for name: UITestScenario.Name) -> UITestScenario.Seed {
        switch name {
        case .inboxPopulated:
            return scenarioDefaults

        case .inboxMaintenance:
            return seed(server: SeededCowtailAPI.Seed(maintenanceWindows: [CowtailPreviewFixtures.maintenanceWindow]))

        case .inboxIncidents:
            return seed(
                server: SeededCowtailAPI.Seed(
                    items: CowtailPreviewFixtures.items + CowtailPreviewFixtures.incidentItems,
                    incidents: CowtailPreviewFixtures.incidents
                )
            )

        case .inboxEmpty:
            return seed(server: SeededCowtailAPI.Seed(items: []))

        case .inboxError, .inboxCachedOffline:
            return seed(server: SeededCowtailAPI.Seed(itemErrorMessage: "Unable to load items from the seeded API."))

        case .roundupPopulated:
            return scenarioDefaults

        case .roundupEmpty:
            return seed(server: SeededCowtailAPI.Seed(roundupAlerts: [], roundupFixes: []))

        case .alertDeepLinkKnown, .alertDeepLinkMissing:
            return scenarioDefaults

        case .signedOut:
            return seed(apple: signedOutApple, session: idleSession, notification: signedOutNotification)

        case .notificationsPermissionDenied:
            return seed(
                session: idleSession,
                notification: UITestScenario.NotificationSeed(
                    authorizationStatus: .denied,
                    registrationState: .idle,
                    serverRegistrationState: .idle,
                    deviceToken: nil,
                    registrationError: nil,
                    serverRegistrationMessage: nil,
                    preferences: AppNotificationPreferences(),
                    dailyRoundupPreferenceRequiresSignIn: true,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .notificationsReady:
            return seed(
                notification: UITestScenario.NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Created Cowtail device registration.",
                    preferences: ownerPreferences,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .notificationsSyncError:
            return seed(
                notification: UITestScenario.NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .failed,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail could not save this device registration.",
                    preferences: AppNotificationPreferences(),
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: "Seeded notification sync error."
                )
            )

        case .signedOutWithOIDC:
            return seed(server: pocketIDServer, apple: signedOutApple, session: idleSession, notification: signedOutNotification)

        case .signedInWithOIDC:
            return seed(
                server: pocketIDServer,
                apple: signedOutApple,
                session: UITestScenario.SessionSeed(
                    sessionState: .ready,
                    token: "ui-test-session-token",
                    userID: "ui-test-apple-user",
                    expiresAt: .now.addingTimeInterval(60 * 60),
                    lastError: nil,
                    provider: "Pocket ID"
                ),
                notification: UITestScenario.NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: nil,
                    preferences: ownerPreferences,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )
        }
    }

    private static func seed(
        server: SeededCowtailAPI.Seed? = nil,
        apple: UITestScenario.AppleSeed? = nil,
        session: UITestScenario.SessionSeed? = nil,
        notification: UITestScenario.NotificationSeed? = nil
    ) -> UITestScenario.Seed {
        UITestScenario.Seed(
            server: server ?? scenarioDefaults.server,
            apple: apple ?? scenarioDefaults.apple,
            session: session ?? scenarioDefaults.session,
            notification: notification ?? scenarioDefaults.notification
        )
    }
}
