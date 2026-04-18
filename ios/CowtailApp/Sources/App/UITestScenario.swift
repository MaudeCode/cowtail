import AuthenticationServices
import Foundation
import UserNotifications

struct UITestScenario {
    enum Name: String, CaseIterable, Equatable {
        case inboxPopulated = "inbox_populated"
        case inboxEmpty = "inbox_empty"
        case inboxError = "inbox_error"
        case roundupPopulated = "roundup_populated"
        case roundupEmpty = "roundup_empty"
        case alertDeepLinkKnown = "alert_deep_link_known"
        case alertDeepLinkMissing = "alert_deep_link_missing"
        case notificationsNeedsApple = "notifications_needs_apple"
        case notificationsPermissionDenied = "notifications_permission_denied"
        case notificationsReady = "notifications_ready"
        case notificationsSyncError = "notifications_sync_error"
    }

    struct Seed {
        let store: StoreSeed
        let roundupAlerts: [AlertItem]
        let roundupFixes: [AlertFix]
        let apple: AppleSeed
        let session: SessionSeed
        let notification: NotificationSeed

        var apiMode: SeededCowtailAPI.Mode {
            store.apiMode(
                roundupAlerts: roundupAlerts,
                roundupFixes: roundupFixes
            )
        }
    }

    struct StoreSeed {
        let alerts: [AlertItem]
        let health: HealthSummary?
        let fixesByAlertID: [String: [AlertFix]]
        let alertErrorMessage: String?

        func apiMode(
            roundupAlerts: [AlertItem],
            roundupFixes: [AlertFix]
        ) -> SeededCowtailAPI.Mode {
            if let alertErrorMessage {
                return .alertListFailure(
                    message: alertErrorMessage,
                    health: health ?? UITestScenario.seededHealth
                )
            }

            return .success(
                alerts: alerts,
                health: health ?? UITestScenario.seededHealth,
                fixesByAlertID: fixesByAlertID,
                roundupAlerts: roundupAlerts,
                roundupFixes: roundupFixes
            )
        }
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
    }

    struct NotificationSeed {
        let authorizationStatus: UNAuthorizationStatus
        let registrationState: NotificationManager.RegistrationState
        let serverRegistrationState: NotificationManager.ServerRegistrationState
        let deviceToken: String?
        let registrationError: String?
        let serverRegistrationMessage: String?
        let dailyRoundupEnabled: Bool
        let dailyRoundupPreferenceRequiresSignIn: Bool
        let dailyRoundupPreferenceError: String?
    }

    let name: Name
    let seed: Seed

    init?(named name: Name) {
        self.name = name
        self.seed = Self.makeSeed(for: name)
    }

    private static let seededHealth = CowtailPreviewFixtures.health

    private static let seededInboxAlerts = [
        CowtailPreviewFixtures.alert,
        CowtailPreviewFixtures.secondaryAlert,
    ]

    private static let seededInboxFixesByAlertID: [String: [AlertFix]] = [
        CowtailPreviewFixtures.alert.id: CowtailPreviewFixtures.fixes,
    ]

    private static let seededRoundupAlerts = [
        AlertItem(
            id: "roundup-alert-1",
            timestamp: .now.addingTimeInterval(-2 * 60 * 60),
            alertName: "NodeFilesystemPressure",
            severity: .warning,
            namespace: "kube-system",
            node: "node-b",
            outcome: .fixed,
            summary: "Filesystem pressure cleared after log cleanup.",
            rootCause: "Verbose logs filled the node disk.",
            actionTaken: "Expired noisy log files and restarted the daemonset.",
            status: .resolved,
            resolvedAt: .now.addingTimeInterval(-90 * 60),
            messaged: true
        ),
        AlertItem(
            id: "roundup-alert-2",
            timestamp: .now.addingTimeInterval(-5 * 60 * 60),
            alertName: "CephRebalancingLag",
            severity: .warning,
            namespace: "rook-ceph",
            node: "node-a",
            outcome: .selfResolved,
            summary: "Rebalancing lag recovered without intervention.",
            rootCause: "Backfill slowed during compaction.",
            actionTaken: "No manual action was required.",
            status: .resolved,
            resolvedAt: .now.addingTimeInterval(-4 * 60 * 60),
            messaged: true
        ),
    ]

    private static let seededRoundupFixes = [
        AlertFix(
            id: "roundup-fix-1",
            description: "Expired verbose kubelet logs to recover disk space.",
            rootCause: "Unexpected log growth on a worker node.",
            scope: .weekly,
            timestamp: .now.addingTimeInterval(-100 * 60)
        ),
    ]

    private static let signedInAppleSeed = AppleSeed(
        signInState: .signedIn,
        userID: "ui-test-apple-user",
        identityToken: "ui-test-identity-token",
        displayName: "UI Test User",
        email: "ui-test@example.com",
        lastError: nil
    )

    private static let readySessionSeed = SessionSeed(
        sessionState: .ready,
        token: "ui-test-session-token",
        userID: "ui-test-apple-user",
        expiresAt: .now.addingTimeInterval(60 * 60),
        lastError: nil
    )

    private static let idleSessionSeed = SessionSeed(
        sessionState: .idle,
        token: nil,
        userID: nil,
        expiresAt: nil,
        lastError: nil
    )

    private static func makeSeed(for name: Name) -> Seed {
        switch name {
        case .inboxPopulated:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .inboxEmpty:
            return Seed(
                store: StoreSeed(
                    alerts: [],
                    health: seededHealth,
                    fixesByAlertID: [:],
                    alertErrorMessage: nil
                ),
                roundupAlerts: [],
                roundupFixes: [],
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .inboxError:
            return Seed(
                store: StoreSeed(
                    alerts: [],
                    health: seededHealth,
                    fixesByAlertID: [:],
                    alertErrorMessage: "Unable to load alerts from the seeded API."
                ),
                roundupAlerts: [],
                roundupFixes: [],
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .roundupPopulated:
            return Seed(
                store: StoreSeed(
                    alerts: [],
                    health: seededHealth,
                    fixesByAlertID: [:],
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .roundupEmpty:
            return Seed(
                store: StoreSeed(
                    alerts: [],
                    health: seededHealth,
                    fixesByAlertID: [:],
                    alertErrorMessage: nil
                ),
                roundupAlerts: [],
                roundupFixes: [],
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .alertDeepLinkKnown:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .alertDeepLinkMissing:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail can send alert notifications to this device.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .notificationsNeedsApple:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: AppleSeed(
                    signInState: .signedOut,
                    userID: nil,
                    identityToken: nil,
                    displayName: nil,
                    email: nil,
                    lastError: nil
                ),
                session: idleSessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .notDetermined,
                    registrationState: .idle,
                    serverRegistrationState: .waitingForIdentity,
                    deviceToken: nil,
                    registrationError: nil,
                    serverRegistrationMessage: "Sign in with Apple to attach this device token to a Cowtail identity.",
                    dailyRoundupEnabled: false,
                    dailyRoundupPreferenceRequiresSignIn: true,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .notificationsPermissionDenied:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: idleSessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .denied,
                    registrationState: .idle,
                    serverRegistrationState: .idle,
                    deviceToken: nil,
                    registrationError: nil,
                    serverRegistrationMessage: nil,
                    dailyRoundupEnabled: false,
                    dailyRoundupPreferenceRequiresSignIn: true,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .notificationsReady:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .registered,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Created Cowtail device registration.",
                    dailyRoundupEnabled: true,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: nil
                )
            )

        case .notificationsSyncError:
            return Seed(
                store: StoreSeed(
                    alerts: seededInboxAlerts,
                    health: seededHealth,
                    fixesByAlertID: seededInboxFixesByAlertID,
                    alertErrorMessage: nil
                ),
                roundupAlerts: seededRoundupAlerts,
                roundupFixes: seededRoundupFixes,
                apple: signedInAppleSeed,
                session: readySessionSeed,
                notification: NotificationSeed(
                    authorizationStatus: .authorized,
                    registrationState: .registered,
                    serverRegistrationState: .failed,
                    deviceToken: "ui-test-device-token",
                    registrationError: nil,
                    serverRegistrationMessage: "Cowtail could not save this device registration.",
                    dailyRoundupEnabled: false,
                    dailyRoundupPreferenceRequiresSignIn: false,
                    dailyRoundupPreferenceError: "Seeded notification sync error."
                )
            )
        }
    }
}
