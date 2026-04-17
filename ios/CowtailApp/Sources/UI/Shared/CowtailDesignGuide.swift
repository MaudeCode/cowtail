import SwiftUI

/// Cowtail mobile design language:
/// - Prefer framed, card-led sections over dense dashboard grids.
/// - Keep density closer to native iPhone rhythm than to a compressed web port.
/// - Use mono labels for metadata, timestamps, counters, and operational tags.
/// - Keep red as the dominant signal color and avoid decorative accent usage.
/// - Reuse shared surfaces and badges instead of screen-specific restyling.
enum CowtailDesignGuide {
    static let cardCornerRadius: CGFloat = 22
    static let sectionCornerRadius: CGFloat = 18
    static let metricStripCornerRadius: CGFloat = 18
    static let gridOpacity: Double = 0.018
    static let primaryMetricColumns = 2
    static let topLevelSpacing: CGFloat = 14
    static let cardPadding: CGFloat = 14
    static let pageHorizontalPadding: CGFloat = 14
    static let pageHeaderFontSize: CGFloat = 30
    static let pageTopPadding: CGFloat = 10
}

#Preview("Cowtail Shell Reference") {
    NavigationStack {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                    InboxHeaderCard(lastUpdated: .now)
                    InboxMetricsCard(openCount: 84, criticalCount: 3)
                    InboxClusterHealthCard(
                        health: CowtailPreviewFixtures.health,
                        healthErrorMessage: nil,
                        isLoading: false
                    )
                    PrimaryAlertCard(alert: CowtailPreviewFixtures.alert)
                }
                .padding(14)
            }
        }
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
    }
}
