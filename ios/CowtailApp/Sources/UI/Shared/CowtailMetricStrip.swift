import SwiftUI

struct CowtailMetricStripItem: Identifiable {
    enum Emphasis {
        case neutral
        case accent
        case success
        case warning
        case info
    }

    let id = UUID()
    let value: String
    let label: String
    let emphasis: Emphasis
}

struct CowtailMetricStrip: View {
    @Environment(\.cowtailPalette) private var palette

    let items: [CowtailMetricStripItem]

    var body: some View {
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: 0),
            count: CowtailDesignGuide.primaryMetricColumns
        )

        LazyVGrid(columns: columns, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                CowtailMetricTile(
                    value: item.value,
                    title: item.label,
                    tint: tint(for: item.emphasis),
                    usesAccentBackground: item.emphasis == .accent
                )
                .overlay(alignment: .trailing) {
                    if index.isMultiple(of: CowtailDesignGuide.primaryMetricColumns) == false {
                        Rectangle()
                            .fill(palette.border)
                            .frame(width: 1)
                    }
                }
            }
        }
        .background(
            palette.surface,
            in: RoundedRectangle(cornerRadius: CowtailDesignGuide.metricStripCornerRadius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: CowtailDesignGuide.metricStripCornerRadius, style: .continuous)
                .stroke(palette.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: CowtailDesignGuide.metricStripCornerRadius, style: .continuous))
    }

    private func tint(for emphasis: CowtailMetricStripItem.Emphasis) -> Color {
        switch emphasis {
        case .neutral:
            return palette.ink
        case .accent:
            return palette.accent
        case .success:
            return palette.success
        case .warning:
            return palette.warning
        case .info:
            return palette.info
        }
    }
}
