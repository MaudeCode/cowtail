import SwiftUI

struct AlertDetailHeroCard: View {
    @Environment(\.cowtailPalette) private var palette
    let alert: AlertItem

    var body: some View {
        CowtailHeroCard {
            AlertClassificationHeader(outcome: alert.outcome)

            CowtailPageHeader(title: .title(alert.alertName))

            Text(alert.summary)
                .font(.cowtailSans(17, relativeTo: .body))
                .foregroundStyle(.secondary)

            HStack {
                CowtailMonoLabel(text: alert.timestamp.formatted(date: .abbreviated, time: .shortened))
                Spacer()
                if alert.status == .resolved {
                    CowtailStatusBadge(title: "Resolved", tint: palette.info)
                } else if alert.outcome.prefersStrongBadge {
                    CowtailStatusBadge(title: alert.outcome.label, tint: alert.outcome.tint)
                }
            }
        }
    }
}

#Preview {
    AlertDetailHeroCard(alert: CowtailPreviewFixtures.alert)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
