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
                        case .digest(let digestRoute):
                            DigestView(digestRoute: digestRoute)
                        }
                    }
            }
            .tag(AppTab.inbox)
            .tabItem {
                Label("Inbox", systemImage: "bell.badge")
            }

            NavigationStack {
                DigestView(digestRoute: universalLinkRouter.digestRoute)
            }
            .tag(AppTab.digest)
            .tabItem {
                Label(CowtailCopy.roundupTitle, systemImage: "doc.text.image")
            }

            NavigationStack {
                AppInfoView()
            }
            .tag(AppTab.settings)
            .tabItem {
                Label(CowtailCopy.farmhouseTitle, systemImage: "gearshape")
            }
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
