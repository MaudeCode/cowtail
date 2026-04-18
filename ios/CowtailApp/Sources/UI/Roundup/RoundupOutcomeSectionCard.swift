import SwiftUI

struct RoundupOutcomeSectionCard: View {
    let section: RoundupOutcomeSection
    let alerts: [AlertItem]

    private var accessibilityIdentifier: String {
        let stableKey = section.title
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
        return "section.roundup.\(stableKey)"
    }

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: section.title, detail: "\(alerts.count)")

            ForEach(Array(alerts.sorted(by: { $0.timestamp < $1.timestamp }).enumerated()), id: \.element.id) { index, alert in
                NavigationLink {
                    AlertDetailView(alert: alert)
                } label: {
                    CompactActivityRow(alert: alert)
                }
                .buttonStyle(.plain)

                if index < alerts.count - 1 {
                    Divider()
                }
            }
        }
        .accessibilityIdentifier(accessibilityIdentifier)
    }
}
