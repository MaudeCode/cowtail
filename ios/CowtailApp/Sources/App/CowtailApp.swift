import SwiftUI

@main
struct CowtailApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var appleAccountManager = AppleAccountManager.shared
    @StateObject private var appSessionManager = AppSessionManager.shared
    @StateObject private var cowtailStore = CowtailStore()
    @StateObject private var notificationManager = NotificationManager.shared
    @StateObject private var themeSettings = ThemeSettings()
    @StateObject private var universalLinkRouter = UniversalLinkRouter.shared

    init() {
        AppleAccountManager.shared.configure()
        AppSessionManager.shared.configure()
        NotificationManager.shared.configure()
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
