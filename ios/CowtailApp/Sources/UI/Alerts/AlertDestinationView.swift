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
            VStack(spacing: 18) {
                if store.isLoadingAlert(alertID) {
                    ProgressView("Loading alert...")
                } else {
                    Text("Alert unavailable")
                        .font(.system(.title3, design: .rounded, weight: .bold))

                    Text(store.alertError(for: alertID) ?? "Cowtail could not load this alert.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
        }
        .navigationTitle("Alert")
        .navigationBarTitleDisplayMode(.large)
    }
}
