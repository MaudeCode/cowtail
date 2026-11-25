import SwiftUI

/// Sign-in while no session or Apple identity exists, the notification step after a sign-in, then the tabs.
struct RootView: View {
    // Observed so an Apple sign-in or sign-out redraws the root.
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager
    @State private var asksForNotifications = false

    var body: some View {
        Group {
            if !appSessionManager.isSignedIn {
                SignInView()
            } else if asksForNotifications {
                NotificationStepView { asksForNotifications = false }
            } else {
                ContentView()
            }
        }
        .onChange(of: appSessionManager.isSignedIn) { _, isSignedIn in
            // Only a sign-in asks, and only while the system has not asked yet.
            asksForNotifications = isSignedIn && notificationManager.authorizationStatus == .notDetermined
        }
    }
}

struct ContentView: View {
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter
    @EnvironmentObject private var store: CowtailStore

    var body: some View {
        TabView(selection: $universalLinkRouter.selectedTab) {
            NavigationStack(path: $universalLinkRouter.inboxPath) {
                InboxView()
                    .navigationDestination(for: AppRoute.self, destination: destination)
            }
            .tag(AppTab.inbox)
            .tabItem { Label("Inbox", systemImage: "tray") }
            .accessibilityIdentifier("tab.inbox")

            NavigationStack {
                ClusterView()
            }
            .tag(AppTab.cluster)
            .tabItem { Label("Cluster", systemImage: "server.rack") }
            .accessibilityIdentifier("tab.cluster")

            NavigationStack {
                HermesView()
                    .navigationDestination(for: AppRoute.self, destination: destination)
            }
            .tag(AppTab.hermes)
            .tabItem { Label("Hermes", systemImage: "sparkles") }
            .accessibilityIdentifier("tab.hermes")

            NavigationStack(path: $universalLinkRouter.historyPath) {
                HistoryView()
                    .navigationDestination(for: AppRoute.self, destination: destination)
            }
            .tag(AppTab.history)
            .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
            .accessibilityIdentifier("tab.history")
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(palette.accent)
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(palette.surfaceRaised, for: .tabBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await store.refresh() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .cowtailPushReceived)) { _ in
            Task { await store.refresh() }
        }
        .background {
            TextInputServicesWarmupView()
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private func destination(_ route: AppRoute) -> some View {
        switch route {
        case .item, .alert:
            ItemDestinationView(route: route)
        case .incident(let id):
            IncidentDestinationView(id: id)
        case .roundup(let roundupRoute):
            RoundupView(roundupRoute: roundupRoute)
        case .settings:
            SettingsView()
        }
    }
}
