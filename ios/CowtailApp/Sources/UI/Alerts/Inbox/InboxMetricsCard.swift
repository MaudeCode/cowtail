import SwiftUI

struct InboxMetricsCard: View {
    let openCount: Int
    let criticalCount: Int

    var body: some View {
        CowtailMetricStrip(items: [
            .init(value: "\(openCount)", label: "Open Alerts", emphasis: .neutral),
            .init(value: "\(criticalCount)", label: "Critical", emphasis: .accent)
        ])
    }
}

#Preview {
    InboxMetricsCard(openCount: 12, criticalCount: 4)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
