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
    }
}

#Preview {
    ContentView()
        .environmentObject(UniversalLinkRouter.shared)
}
