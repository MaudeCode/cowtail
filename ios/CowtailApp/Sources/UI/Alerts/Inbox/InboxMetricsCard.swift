import SwiftUI

struct InboxMetricsCard: View {
    let needsYouCount: Int
    let inProgressCount: Int

    var body: some View {
        CowtailMetricStrip(items: [
            .init(value: "\(needsYouCount)", label: "Needs You", emphasis: .accent),
            .init(value: "\(inProgressCount)", label: "In Progress", emphasis: .neutral)
        ])
    }
}

#Preview {
    InboxMetricsCard(needsYouCount: 2, inProgressCount: 4)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
