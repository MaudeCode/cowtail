import SwiftUI

struct RoundupSummaryCard: View {
    let stats: RoundupStats

    var body: some View {
        CowtailMetricStrip(items: [
            CowtailMetricStripItem(value: "\(stats.total)", label: "Alerts", emphasis: .neutral),
            CowtailMetricStripItem(value: "\(stats.fixed)", label: "Fixed", emphasis: .success),
            CowtailMetricStripItem(value: "\(stats.escalated)", label: "Escalated", emphasis: .warning),
            CowtailMetricStripItem(value: "\(stats.fixes)", label: "Fixes", emphasis: .info)
        ])
    }
}
