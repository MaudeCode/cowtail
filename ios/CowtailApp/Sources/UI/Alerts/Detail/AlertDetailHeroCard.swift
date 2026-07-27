import SwiftUI

struct AlertDetailHeroCard: View {
    @Environment(\.cowtailPalette) private var palette
    let alert: AlertItem

    var body: some View {
        CowtailHeroCard {
            AlertClassificationHeader(state: alert.workflowState)

            CowtailPageHeader(title: .title(alert.alertName))

            Text(alert.summary)
                .font(.cowtailSans(17, relativeTo: .body))
                .foregroundStyle(.secondary)

            HStack {
                CowtailMonoLabel(text: alert.timestamp.formatted(date: .abbreviated, time: .shortened))
                Spacer()
                CowtailStatusBadge(title: alert.status.label, tint: alert.status == .firing ? .orange : palette.info)
            }
        }
    }
}

#Preview {
    AlertDetailHeroCard(alert: CowtailPreviewFixtures.alert)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
