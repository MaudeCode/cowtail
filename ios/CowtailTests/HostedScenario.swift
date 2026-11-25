import SwiftUI
@testable import Cowtail

@MainActor
extension UITestScenario {
    static func fixtureStore(_ scenario: Name) -> CowtailStore {
        let api = SeededCowtailAPI(seed: UITestScenario(named: scenario).seed.server)
        return CowtailStore(
            api: api, sessionToken: { "fixture-session" },
            authenticator: SeededApprovalAuthenticator(),
            requiresApprovalAuthentication: { false },
            notificationCenter: FakeNotificationCenter()
        )
    }
}

extension HostedScreen {
    static func root(_ scenario: UITestScenario.Name, settings: Bool = false) throws -> HostedScreen {
        let runtime = AppRuntime.make(configuration: AppLaunchConfiguration(
            mode: .uiTesting(scenario), resetPersistentState: true,
            deepLinkURL: nil, selectedTab: settings ? .settings : .inbox
        ))
        return try HostedScreen(RootView()
            .environmentObject(runtime.appleAccountManager)
            .environmentObject(runtime.appSessionManager)
            .environmentObject(runtime.cowtailStore)
            .environmentObject(runtime.oidcSignIn)
            .environmentObject(runtime.notificationManager)
            .environmentObject(runtime.themeSettings)
            .environmentObject(runtime.universalLinkRouter)
            .environment(\.roundupDataClient, runtime.roundupDataClient))
    }
}
