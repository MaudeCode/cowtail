import SwiftUI

struct AlertClassificationHeader: View {
    let state: AlertWorkflowState

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: state.symbolName)
                .font(.caption.weight(.semibold))
            CowtailMonoLabel(text: state.label, tint: state.tint)
        }
    }
}

struct PrimaryAlertCard: View {
    @Environment(\.cowtailPalette) private var palette
    let alert: AlertItem

    var body: some View {
        CowtailCard {
            topRow

            Text(alert.alertName)
                .font(.cowtailSans(16, weight: .bold, relativeTo: .headline))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .fixedSize(horizontal: false, vertical: true)

            Text(alert.summary)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .center, spacing: 8) {
                    CowtailMonoLabel(text: alert.severity.label, tint: alert.severity.tint)

                    CowtailMonoLabel(text: alert.outcome.label, tint: alert.outcome.tint)
                }

                if !alert.sourceLine.isEmpty {
                    CowtailMonoLabel(text: alert.sourceLine)
                        .lineLimit(1)
                        .opacity(0.9)
                }
            }
        }
    }

    private var topRow: some View {
        HStack(alignment: .center, spacing: 8) {
            AlertClassificationHeader(state: alert.workflowState)
            Spacer()
            CowtailMonoLabel(text: alert.timestamp.formatted(.relative(presentation: .named)))
        }
    }
}

#Preview {
    PrimaryAlertCard(alert: CowtailPreviewFixtures.alert)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
