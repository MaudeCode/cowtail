import SwiftUI

@MainActor
final class AppRuntime {
    let appleAccountManager: AppleAccountManager
    let appSessionManager: AppSessionManager
    let cowtailStore: CowtailStore
    let notificationManager: NotificationManager
    let openClawStore: OpenClawStore
    let themeSettings: ThemeSettings
    let universalLinkRouter: UniversalLinkRouter
    let roundupDataClient: any RoundupDataClient

    private static let currentRuntime = AppRuntime.make(configuration: .current())

    init(
        appleAccountManager: AppleAccountManager,
        appSessionManager: AppSessionManager,
        cowtailStore: CowtailStore,
        notificationManager: NotificationManager,
        openClawStore: OpenClawStore,
        themeSettings: ThemeSettings,
        universalLinkRouter: UniversalLinkRouter,
        roundupDataClient: any RoundupDataClient
    ) {
        self.appleAccountManager = appleAccountManager
        self.appSessionManager = appSessionManager
        self.cowtailStore = cowtailStore
        self.notificationManager = notificationManager
        self.openClawStore = openClawStore
        self.themeSettings = themeSettings
        self.universalLinkRouter = universalLinkRouter
        self.roundupDataClient = roundupDataClient
    }

    static func current() -> AppRuntime {
        currentRuntime
    }

    static func make(configuration: AppLaunchConfiguration) -> AppRuntime {
        let appleAccountManager = AppleAccountManager.shared
        let appSessionManager = AppSessionManager.shared
        let notificationManager = NotificationManager.shared
        let universalLinkRouter = UniversalLinkRouter.shared
        let themeSettings = ThemeSettings()

        switch configuration.mode {
        case .normal:
            let api = CowtailAPI()
            appleAccountManager.configure()
            appSessionManager.configure()
            notificationManager.configure()
            return AppRuntime(
                appleAccountManager: appleAccountManager,
                appSessionManager: appSessionManager,
                cowtailStore: CowtailStore(api: api),
                notificationManager: notificationManager,
                openClawStore: OpenClawStore(
                    api: OpenClawAPI(),
                    realtime: OpenClawRealtimeClient(),
                    appSessionManager: appSessionManager
                ),
                themeSettings: themeSettings,
                universalLinkRouter: universalLinkRouter,
                roundupDataClient: api
            )

        case .uiTesting(let scenarioName):
            if configuration.resetPersistentState {
                appleAccountManager.resetForUITesting()
                appSessionManager.resetForUITesting()
                notificationManager.resetForUITesting()
            }

            let scenario = UITestScenario(named: scenarioName)
            let seededAPI = SeededCowtailAPI(mode: scenario.seed.apiMode)

            appleAccountManager.seedForUITesting(
                signInState: scenario.seed.apple.signInState,
                userID: scenario.seed.apple.userID,
                identityToken: scenario.seed.apple.identityToken,
                displayName: scenario.seed.apple.displayName,
                email: scenario.seed.apple.email,
                lastError: scenario.seed.apple.lastError
            )
            appSessionManager.seedForUITesting(
                sessionState: scenario.seed.session.sessionState,
                token: scenario.seed.session.token,
                userID: scenario.seed.session.userID,
                expiresAt: scenario.seed.session.expiresAt,
                lastError: scenario.seed.session.lastError
            )
            notificationManager.seedForUITesting(
                authorizationStatus: scenario.seed.notification.authorizationStatus,
                registrationState: scenario.seed.notification.registrationState,
                serverRegistrationState: scenario.seed.notification.serverRegistrationState,
                deviceToken: scenario.seed.notification.deviceToken,
                registrationError: scenario.seed.notification.registrationError,
                serverRegistrationMessage: scenario.seed.notification.serverRegistrationMessage,
                dailyRoundupEnabled: scenario.seed.notification.dailyRoundupEnabled,
                dailyRoundupPreferenceRequiresSignIn: scenario.seed.notification.dailyRoundupPreferenceRequiresSignIn,
                dailyRoundupPreferenceError: scenario.seed.notification.dailyRoundupPreferenceError
            )
            universalLinkRouter.applyUITestStartupSelection(
                selectedTab: configuration.selectedTab,
                deepLinkURL: configuration.deepLinkURL
            )
            let openClawDefaults = UserDefaults.standard
            openClawDefaults.set(scenario.seed.openClaw.displayName, forKey: "openclaw.displayName")

            return AppRuntime(
                appleAccountManager: appleAccountManager,
                appSessionManager: appSessionManager,
                cowtailStore: CowtailStore(
                    api: seededAPI,
                    alerts: scenario.seed.store.alerts,
                    health: scenario.seed.store.health,
                    fixesByAlertID: scenario.seed.store.fixesByAlertID,
                    errorMessage: scenario.seed.store.alertErrorMessage,
                    hasLoaded: true
                ),
                notificationManager: notificationManager,
                openClawStore: OpenClawStore(
                    api: OpenClawSeededAPI(seed: scenario.seed.openClaw),
                    realtime: OpenClawSeededRealtime(),
                    appSessionManager: appSessionManager,
                    defaults: openClawDefaults
                ),
                themeSettings: themeSettings,
                universalLinkRouter: universalLinkRouter,
                roundupDataClient: seededAPI
            )
        }
    }
}

private struct RoundupDataClientKey: EnvironmentKey {
    static let defaultValue: any RoundupDataClient = CowtailAPI()
}

extension EnvironmentValues {
    var roundupDataClient: any RoundupDataClient {
        get { self[RoundupDataClientKey.self] }
        set { self[RoundupDataClientKey.self] = newValue }
    }
}
