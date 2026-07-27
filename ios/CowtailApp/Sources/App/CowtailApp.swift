import SwiftUI

@main
struct CowtailApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    private let runtime: AppRuntime
    @StateObject private var appleAccountManager: AppleAccountManager
    @StateObject private var appSessionManager: AppSessionManager
    @StateObject private var cowtailStore: CowtailStore
    @StateObject private var notificationManager: NotificationManager
    @StateObject private var themeSettings: ThemeSettings
    @StateObject private var universalLinkRouter: UniversalLinkRouter

    init() {
        let runtime = AppRuntime.current()
        self.runtime = runtime
        _appleAccountManager = StateObject(wrappedValue: runtime.appleAccountManager)
        _appSessionManager = StateObject(wrappedValue: runtime.appSessionManager)
        _cowtailStore = StateObject(wrappedValue: runtime.cowtailStore)
        _notificationManager = StateObject(wrappedValue: runtime.notificationManager)
        _themeSettings = StateObject(wrappedValue: runtime.themeSettings)
        _universalLinkRouter = StateObject(wrappedValue: runtime.universalLinkRouter)
    }

    var body: some Scene {
        WindowGroup {
            ThemedRoot {
                ContentView()
                    .environmentObject(appleAccountManager)
                    .environmentObject(appSessionManager)
                    .environmentObject(cowtailStore)
                    .environmentObject(notificationManager)
                    .environmentObject(universalLinkRouter)
            }
            .environmentObject(themeSettings)
            .environment(\.roundupDataClient, runtime.roundupDataClient)
            .preferredColorScheme(themeSettings.appearancePreference.colorScheme)
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { userActivity in
                guard let url = userActivity.webpageURL else {
                    return
                }

                _ = universalLinkRouter.handle(url)
            }
            .onOpenURL { url in
                _ = universalLinkRouter.handle(url)
            }
        }
    }
}
