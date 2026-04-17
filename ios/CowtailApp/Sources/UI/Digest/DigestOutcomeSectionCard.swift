import SwiftUI

struct DigestOutcomeSectionCard: View {
    let section: DigestOutcomeSection
    let alerts: [AlertItem]

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
    }
}
