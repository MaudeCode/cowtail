import SwiftUI

struct AlertDestinationView: View {
    @EnvironmentObject private var store: CowtailStore

    let alertID: String

    var body: some View {
        Group {
            if let alert = store.alert(withID: alertID) {
                AlertDetailView(alert: alert)
            } else {
                placeholder
            }
        }
        .task {
            await store.loadAlert(id: alertID)
        }
    }

    private var placeholder: some View {
        CowtailCanvas {
            VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                CowtailPageHeader(title: .title("Alert"))

                if store.isLoadingAlert(alertID) {
                    ProgressView("Loading alert...")
                } else {
                    Text("Alert unavailable")
                        .font(.cowtailSans(20, weight: .bold, relativeTo: .title3))

                    Text(store.alertError(for: alertID) ?? "Cowtail could not load this alert.")
                        .font(.cowtailSans(13, relativeTo: .footnote))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
    }
}
