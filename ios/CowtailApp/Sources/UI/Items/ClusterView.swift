import Charts
import SwiftUI

struct ClusterView: View {
    @Environment(CowtailStore.self) private var store
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        CowtailScreen(title: "Cluster", identifier: "screen.cluster", contentMaxWidth: 720) {
            if let state = store.health?.pipelineState {
                CowtailStatusBadge(title: state.label, tint: state.tint(palette), showsDot: true)
                    .accessibilityIdentifier("chip.cluster.pipeline")
            }
        } content: {
            if let lastWatchdogAt = store.health?.lastWatchdogAt {
                Text("Last Watchdog \(ItemFormat.age(of: lastWatchdogAt)) ago")
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
                    .padding(.top, 4)
                    .accessibilityIdentifier("text.cluster.last-watchdog")
            }
            if let error = store.healthErrorMessage {
                Text(error)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
                    .padding(.top, 8)
            }

            if let health = store.health {
                nodes(health)
                ceph(health)
            }
            if let stats = store.clusterStats {
                firing(stats)
                volume(stats)
                noisiest(stats)
            }
        }
        .polling { await store.refresh() }
    }

    @ViewBuilder
    private func nodes(_ health: HealthSummary) -> some View {
        CowtailSectionHeader(title: "Nodes", detail: "\(health.readyNodeCount) ready")
        ForEach(health.nodes) { node in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(node.name).font(.cowtailMono(13, relativeTo: .footnote))
                    Spacer()
                    Text(node.isReady ? "Ready" : "Not ready")
                        .font(.cowtailMono(12, relativeTo: .caption))
                        .foregroundStyle(node.isReady ? palette.success : palette.accent)
                }
                UsageBar(label: "CPU", fraction: Double(node.cpu) / 100, value: "\(node.cpu)%")
                UsageBar(label: "MEM", fraction: Double(node.memory) / 100, value: "\(node.memory)%")
            }
            .cowtailRow()
        }
    }

    @ViewBuilder
    private func ceph(_ health: HealthSummary) -> some View {
        CowtailSectionHeader(title: "Ceph", detail: health.cephStatus)
        Text(health.cephMessage)
            .font(.cowtailSans(13, relativeTo: .footnote))
            .cowtailRow()
        UsageBar(
            label: "Storage",
            fraction: health.storageTotal > 0 ? health.storageUsed / health.storageTotal : 0,
            value: "\(health.storageUsed.formatted(.number.precision(.fractionLength(0...1)))) / \(health.storageTotal.formatted(.number.precision(.fractionLength(0...1)))) \(health.storageUnit)"
        )
        .cowtailRow()
    }

    @ViewBuilder
    private func firing(_ stats: ItemStats) -> some View {
        CowtailSectionHeader(title: "Firing by namespace", detail: "\(stats.firingCount)")
        ForEach(stats.firingByNamespace, id: \.namespace) { row in
            CowtailKeyValueRow(key: row.namespace.isEmpty ? "—" : row.namespace, value: "\(row.count)")
        }
    }

    @ViewBuilder
    private func volume(_ stats: ItemStats) -> some View {
        CowtailSectionHeader(
            title: "Volume · \(stats.dailyVolume.count) days",
            detail: "\(stats.createdCount)"
        )
        Chart {
            ForEach(stats.dailyVolume, id: \.date) { day in
                ForEach(stats.volumeSources, id: \.self) { source in
                    if let count = day.bySource[source] {
                        BarMark(x: .value("Day", dayLabel(day.date)), y: .value("Items", count))
                            .foregroundStyle(by: .value("Source", source))
                    }
                }
                // The day's total, above its bar.
                PointMark(x: .value("Day", dayLabel(day.date)), y: .value("Items", day.total))
                    .symbolSize(0)
                    .annotation(position: .top) {
                        Text("\(day.total)")
                            .font(.cowtailMono(10, relativeTo: .caption))
                            .foregroundStyle(palette.mutedInk)
                    }
            }
        }
        .chartForegroundStyleScale(
            domain: stats.volumeSources,
            range: [palette.accent, palette.info, palette.mutedInk, palette.warning, palette.success]
        )
        .chartLegend(position: .bottom, alignment: .leading)
        .frame(height: 150)
        .padding(.vertical, 8)
        .accessibilityIdentifier("chart.cluster.volume")
    }

    @ViewBuilder
    private func noisiest(_ stats: ItemStats) -> some View {
        CowtailSectionHeader(title: "Noisiest")
        ForEach(stats.repeatOffenders, id: \.dedupeKey) { offender in
            CowtailKeyValueRow(
                key: offender.title,
                value: "×\(offender.occurrenceCount) · \(ItemFormat.percent(offender.noiseShare)) noise"
            )
        }
    }

    private func dayLabel(_ date: String) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.dateFormat = "yyyy-MM-dd"
        guard let day = parser.date(from: date) else { return date }
        return day.formatted(.dateTime.weekday(.abbreviated))
    }
}

/// A label, an inline bar and its value.
struct UsageBar: View {
    @Environment(\.cowtailPalette) private var palette

    let label: String
    let fraction: Double
    let value: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.cowtailMono(11, relativeTo: .caption))
                .foregroundStyle(palette.mutedInk)
                .frame(width: 54, alignment: .leading)
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(palette.border)
                    Capsule()
                        .fill(palette.success)
                        .frame(width: geometry.size.width * min(max(fraction, 0), 1))
                }
            }
            .frame(height: 5)
            Text(value)
                .font(.cowtailMono(11, relativeTo: .caption))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}
