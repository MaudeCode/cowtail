import SwiftUI

/// Cowtail mobile design language (docs/mockups/app-rewrite.html):
/// - A section is a small uppercase mono label over rows split by hairlines; no card encloses it.
/// - Use mono labels for metadata, timestamps, counters, and operational tags.
/// - Keep red as the dominant signal color and avoid decorative accent usage.
/// - Reuse shared chips, headers and rows instead of screen-specific restyling.
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
