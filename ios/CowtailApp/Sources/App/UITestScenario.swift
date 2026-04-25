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
        case openClawPopulated = "openclaw_populated"
        case openClawEmpty = "openclaw_empty"
        case openClawSignedOut = "openclaw_signed_out"
    }

    struct Seed {
        let store: StoreSeed
        let roundupAlerts: [AlertItem]
        let roundupFixes: [AlertFix]
        let apple: AppleSeed
        let session: SessionSeed
        let notification: NotificationSeed
        let openClaw: OpenClawSeed

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
                    health: health ?? FixtureCatalog.health
                )
            }

            return .success(
                alerts: alerts,
                health: health ?? FixtureCatalog.health,
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

    struct OpenClawSeed {
        let displayName: String
        let threads: [OpenClawThread]
        let messagesByThreadID: [String: [OpenClawMessageWithActions]]
    }

    let name: Name
    let seed: Seed

    init(named name: Name) {
        self.name = name
        self.seed = SeedFactory.makeSeed(for: name)
    }
}

private enum FixtureCatalog {
    static let health = CowtailPreviewFixtures.health
    static let inboxAlerts = [
        CowtailPreviewFixtures.alert,
        AlertItem(
            id: "preview-alert-3",
            timestamp: .now.addingTimeInterval(-6 * 60),
            alertName: "NodePressureSustained",
            severity: .warning,
            namespace: "kube-system",
            node: "node-b",
            outcome: .escalated,
            summary: "Memory pressure remains elevated on node-b.",
            rootCause: "A bursty workload has not scaled back down yet.",
            actionTaken: "Paged the on-call and started a workload audit.",
            status: .firing,
            resolvedAt: nil,
            messaged: true
        ),
        AlertItem(
            id: "preview-alert-4",
            timestamp: .now.addingTimeInterval(-12 * 60),
            alertName: "CephPlacementGroupsDegraded",
            severity: .critical,
            namespace: "rook-ceph",
            node: "node-c",
            outcome: .escalated,
            summary: "Placement groups are degraded and need intervention.",
            rootCause: "Recovery lag has left several placement groups undersized.",
            actionTaken: "Started recovery checks and escalated the storage incident.",
            status: .firing,
            resolvedAt: nil,
            messaged: true
        ),
        AlertItem(
            id: "preview-alert-5",
            timestamp: .now.addingTimeInterval(-18 * 60),
            alertName: "IngressErrorRateHigh",
            severity: .warning,
            namespace: "ingress-nginx",
            node: "node-a",
            outcome: .escalated,
            summary: "Ingress error rate is above the paging threshold.",
            rootCause: "Backend timeouts increased after a rollout.",
            actionTaken: "Rolled back the ingress config and opened an incident.",
            status: .firing,
            resolvedAt: nil,
            messaged: true
        ),
        CowtailPreviewFixtures.secondaryAlert,
    ]
    static let inboxFixesByAlertID: [String: [AlertFix]] = [
        CowtailPreviewFixtures.alert.id: CowtailPreviewFixtures.fixes,
    ]
    static let roundupAlerts = [
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
    static let roundupFixes = [
        AlertFix(
            id: "roundup-fix-1",
            description: "Expired verbose kubelet logs to recover disk space.",
            rootCause: "Unexpected log growth on a worker node.",
            scope: .weekly,
            timestamp: .now.addingTimeInterval(-100 * 60)
        ),
    ]
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
        lastError: nil
    )

    private static let idleSession = UITestScenario.SessionSeed(
        sessionState: .idle,
        token: nil,
        userID: nil,
        expiresAt: nil,
        lastError: nil
    )

    private static let connectedNotification = UITestScenario.NotificationSeed(
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

    private static let openClawDefault = UITestScenario.OpenClawSeed(
        displayName: "Maude",
        threads: [CowtailPreviewFixtures.openClawThread],
        messagesByThreadID: [
            CowtailPreviewFixtures.openClawThread.id: []
        ]
    )

    private static let scenarioDefaults = UITestScenario.Seed(
        store: UITestScenario.StoreSeed(
            alerts: FixtureCatalog.inboxAlerts,
            health: FixtureCatalog.health,
            fixesByAlertID: FixtureCatalog.inboxFixesByAlertID,
            alertErrorMessage: nil
        ),
        roundupAlerts: FixtureCatalog.roundupAlerts,
        roundupFixes: FixtureCatalog.roundupFixes,
        apple: signedInApple,
        session: readySession,
        notification: connectedNotification,
        openClaw: openClawDefault
    )

    static func makeSeed(for name: UITestScenario.Name) -> UITestScenario.Seed {
        switch name {
        case .inboxPopulated:
            return scenarioDefaults

        case .inboxEmpty:
            return seed(
                store: emptyStore()
            )

        case .inboxError:
            return seed(
                store: emptyStore(errorMessage: "Unable to load alerts from the seeded API.")
            )

        case .roundupPopulated:
            return seed(
                store: emptyStore()
            )

        case .roundupEmpty:
            return seed(
                store: emptyStore(),
                roundupAlerts: [],
                roundupFixes: []
            )

        case .alertDeepLinkKnown, .alertDeepLinkMissing:
            return scenarioDefaults

        case .notificationsNeedsApple:
            return seed(
                apple: signedOutApple,
                session: idleSession,
                notification: UITestScenario.NotificationSeed(
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
            return seed(
                session: idleSession,
                notification: UITestScenario.NotificationSeed(
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
            return seed(
                notification: UITestScenario.NotificationSeed(
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
            return seed(
                notification: UITestScenario.NotificationSeed(
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

        case .openClawPopulated:
            return seed(openClaw: openClawDefault)

        case .openClawEmpty:
            return seed(openClaw: .init(displayName: "Maude", threads: [], messagesByThreadID: [:]))

        case .openClawSignedOut:
            return seed(
                session: idleSession,
                openClaw: .init(displayName: "OpenClaw", threads: [], messagesByThreadID: [:])
            )
        }
    }

    private static func emptyStore(errorMessage: String? = nil) -> UITestScenario.StoreSeed {
        UITestScenario.StoreSeed(
            alerts: [],
            health: FixtureCatalog.health,
            fixesByAlertID: [:],
            alertErrorMessage: errorMessage
        )
    }

    private static func seed(
        store: UITestScenario.StoreSeed? = nil,
        roundupAlerts: [AlertItem]? = nil,
        roundupFixes: [AlertFix]? = nil,
        apple: UITestScenario.AppleSeed? = nil,
        session: UITestScenario.SessionSeed? = nil,
        notification: UITestScenario.NotificationSeed? = nil,
        openClaw: UITestScenario.OpenClawSeed? = nil
    ) -> UITestScenario.Seed {
        UITestScenario.Seed(
            store: store ?? scenarioDefaults.store,
            roundupAlerts: roundupAlerts ?? scenarioDefaults.roundupAlerts,
            roundupFixes: roundupFixes ?? scenarioDefaults.roundupFixes,
            apple: apple ?? scenarioDefaults.apple,
            session: session ?? scenarioDefaults.session,
            notification: notification ?? scenarioDefaults.notification,
            openClaw: openClaw ?? scenarioDefaults.openClaw
        )
    }
}
