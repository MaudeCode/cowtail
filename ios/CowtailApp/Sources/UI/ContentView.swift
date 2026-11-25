import SwiftUI

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
        // Every owner action ends in a success or an error haptic, wherever it started.
        .sensoryFeedback(trigger: store.actionFeedback) { _, feedback in
            feedback.map { $0.succeeded ? .success : .error }
        }
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
