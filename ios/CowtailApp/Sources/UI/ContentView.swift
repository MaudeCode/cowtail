import SwiftUI

struct ContentView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    var body: some View {
        TabView(selection: $universalLinkRouter.selectedTab) {
            NavigationStack(path: $universalLinkRouter.inboxPath) {
                AlertInboxView()
                    .navigationDestination(for: InboxRoute.self) { route in
                        switch route {
                        case .alert(let alertID):
                            AlertDestinationView(alertID: alertID)
                        }
                    }
            }
            .tag(AppTab.inbox)
            .tabItem {
                Label("Inbox", systemImage: "bell.badge")
            }

            NavigationStack {
                AppInfoView()
            }
            .tag(AppTab.settings)
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(palette.accent)
    }
}

#Preview {
    ContentView()
        .environmentObject(UniversalLinkRouter.shared)
}
