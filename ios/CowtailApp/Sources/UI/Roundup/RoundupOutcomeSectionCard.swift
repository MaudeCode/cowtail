import SwiftUI

struct RoundupOutcomeSectionCard: View {
    @Environment(\.cowtailPalette) private var palette
    let section: RoundupOutcomeSection
    let alerts: [AlertItem]

    private var accessibilityIdentifier: String {
        "section.roundup.\(section.accessibilityKey)"
    }

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: section.title, detail: "\(alerts.count)")

            ForEach(Array(alerts.sorted(by: { $0.timestamp < $1.timestamp }).enumerated()), id: \.element.id) { index, alert in
                NavigationLink(value: AppRoute.alert(alert.id)) {
                    row(alert)
                }
                .buttonStyle(.plain)

                if index < alerts.count - 1 {
                    Divider()
                }
            }
        }
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func row(_ alert: AlertItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(alert.alertName)
                    .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                CowtailMonoLabel(text: alert.timestamp.formatted(.relative(presentation: .named)))
            }
            CowtailMonoLabel(text: [alert.namespace, alert.node].filter { !$0.isEmpty }.joined(separator: " / "))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}
