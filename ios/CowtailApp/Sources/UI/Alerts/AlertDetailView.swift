import SwiftUI

struct AlertDetailView: View {
    @EnvironmentObject private var store: CowtailStore

    let alert: AlertItem

    private var fixes: [AlertFix] {
        store.fixesByAlertID[alert.id] ?? []
    }

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                    AlertDetailHeroCard(alert: alert)

                    if !alert.actionTaken.isEmpty {
                        AlertTextSectionCard(title: "Recorded Action", bodyText: alert.actionTaken)
                    }

                    if !alert.rootCause.isEmpty {
                        AlertTextSectionCard(title: "Root Cause", bodyText: alert.rootCause)
                    }

                    AlertMetadataCard(alert: alert)
                    AlertLinksCard(alert: alert)
                    AlertFixesCard(fixes: fixes)
                }
                .padding(14)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.alert-detail")
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            await store.loadFixes(for: alert.id)
        }
    }
}

#Preview {
    NavigationStack {
        AlertDetailView(alert: CowtailPreviewFixtures.alert)
            .environmentObject(CowtailStore(fixesByAlertID: [CowtailPreviewFixtures.alert.id: CowtailPreviewFixtures.fixes]))
    }
}
