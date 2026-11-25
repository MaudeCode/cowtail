import SwiftUI

/// Sign-in while no session or Apple identity exists, the notification step after a sign-in, then the tabs.
struct RootView: View {
    // Observed so an Apple sign-in or sign-out redraws the root.
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager
    @EnvironmentObject private var store: CowtailStore
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
            if !isSignedIn {
                store.discardInbox()
            }
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

    @State private var hermesPath: [AppRoute] = []

    var body: some View {
        TabView(selection: $universalLinkRouter.selectedTab) {
            TabNavigation(path: $universalLinkRouter.inboxPath, destination: destination) {
                InboxView()
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

            TabNavigation(path: $hermesPath, destination: destination) {
                HermesView()
            }
            .tag(AppTab.hermes)
            .tabItem { Label("Hermes", systemImage: "sparkles") }
            .accessibilityIdentifier("tab.hermes")

            TabNavigation(path: $universalLinkRouter.historyPath, destination: destination) {
                HistoryView()
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

/// The router owns the route across presentations. A wide layout reads it as the
/// selected detail; the compact stack also uses its ancestry for the Back gesture.
private struct TabNavigation<Root: View, Destination: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var visibility = NavigationSplitViewVisibility.all
    @Binding var path: [AppRoute]
    @ViewBuilder let destination: (AppRoute) -> Destination
    @ViewBuilder let root: () -> Root

    var body: some View {
        Group {
            if sizeClass == .regular {
                splitView
            } else {
                NavigationStack(path: $path) {
                    root()
                        .navigationDestination(for: AppRoute.self, destination: destination)
                }
            }
        }
        .onChange(of: sizeClass) { _, size in
            if size == .regular {
                visibility = .all
            }
        }
    }

    private var splitView: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            sidebar
                .navigationSplitViewColumnWidth(min: 280, ideal: 340, max: 400)
        } detail: {
            Group {
                if let selection = path.last {
                    destination(selection)
                        .id(selection)
                } else {
                    CowtailCanvas {
                        ContentUnavailableView("Select an item", systemImage: "rectangle.split.2x1")
                    }
                }
            }
            .environment(\.splitRouteSelection, Binding(
                get: { nil },
                set: {
                    if let route = $0 {
                        path.append(route)
                    }
                }
            ))
            .toolbar {
                if path.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        CowtailIconButton(title: "Back", systemImage: "chevron.backward", style: .borderless) {
                            path.removeLast()
                        }
                    }
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private var sidebar: some View {
        if case .incident(let id)? = path.dropLast().last {
            IncidentDestinationView(id: id)
                .environment(\.splitRouteSelection, Binding(
                    get: { path.last },
                    set: {
                        if let route = $0 {
                            path = Array(path.dropLast()) + [route]
                        }
                    }
                ))
        } else {
            root()
                .environment(\.splitRouteSelection, Binding(
                    get: { path.first },
                    set: { path = $0.map { [$0] } ?? [] }
                ))
        }
    }
}

extension EnvironmentValues {
    @Entry var splitRouteSelection: Binding<AppRoute?>?
}

/// Keeps the row's existing label and actions while selecting a column on wide layouts.
struct CowtailRouteLink<Label: View>: View {
    @Environment(\.splitRouteSelection) private var selection
    @Environment(\.cowtailPalette) private var palette
    let value: AppRoute
    @ViewBuilder let label: () -> Label

    var body: some View {
        if let selection {
            let isSelected = selection.wrappedValue == value
            Button { selection.wrappedValue = value } label: {
                label()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .listRowBackground(isSelected ? palette.accentSoft : nil)
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        } else {
            NavigationLink(value: value, label: label)
        }
    }
}
