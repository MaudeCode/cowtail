import SwiftUI

struct ContentView: View {
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var openClawStore: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    var body: some View {
        TabView(selection: $universalLinkRouter.selectedTab) {
            NavigationStack(path: $universalLinkRouter.inboxPath) {
                AlertInboxView()
                    .navigationDestination(for: InboxRoute.self) { route in
                        switch route {
                        case .alert(let alertID):
                            AlertDestinationView(alertID: alertID)
                        case .roundup(let roundupRoute):
                            RoundupView(roundupRoute: roundupRoute)
                        }
                    }
            }
            .tag(AppTab.inbox)
            .tabItem {
                Label("Inbox", systemImage: "bell.badge")
            }
            .accessibilityIdentifier("tab.inbox")

            NavigationStack {
                RoundupView(roundupRoute: universalLinkRouter.roundupRoute)
            }
            .tag(AppTab.roundup)
            .tabItem {
                Label(CowtailCopy.roundupTitle, systemImage: "doc.text.image")
            }
            .accessibilityIdentifier("tab.roundup")

            NavigationStack(path: $universalLinkRouter.openClawPath) {
                OpenClawThreadListView()
                    .navigationDestination(for: OpenClawRoute.self) { route in
                        switch route {
                        case .thread(let threadID):
                            OpenClawThreadDetailView(threadID: threadID)
                        }
                    }
            }
            .tag(AppTab.openclaw)
            .tabItem {
                Label(openClawTabTitle, systemImage: "bubble.left.and.bubble.right")
            }
            .badge(openClawStore.unreadCount)
            .accessibilityIdentifier("tab.openclaw")

            NavigationStack {
                FarmhouseView()
            }
            .tag(AppTab.farmhouse)
            .tabItem {
                Label(CowtailCopy.farmhouseTitle, systemImage: "gearshape")
            }
            .accessibilityIdentifier("tab.farmhouse")
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(palette.accent)
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(palette.surfaceRaised, for: .tabBar)
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            await openClawStore.refreshIfPossible()
            await openClawStore.connectForeground()
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                Task {
                    await openClawStore.refreshIfPossible()
                    await openClawStore.connectForeground()
                }
            case .background, .inactive:
                openClawStore.disconnectForeground()
            @unknown default:
                break
            }
        }
    }

    private var openClawTabTitle: String {
        let displayName = openClawStore.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return displayName.isEmpty ? "OpenClaw" : displayName
    }
}

#Preview {
    ContentView()
        .environmentObject(CowtailPreviewFixtures.openClawStore())
        .environmentObject(UniversalLinkRouter.shared)
}
