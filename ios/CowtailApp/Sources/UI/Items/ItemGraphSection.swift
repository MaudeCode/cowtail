import Charts
import SwiftUI

/// The alert's own metric, labelled with the expression drawn: a line per series over a dashed
/// threshold rule and a shaded firing band. Hidden while the server has no graph for the item.
struct ItemGraphSection: View {
    let itemID: String

    @Environment(CowtailStore.self) private var store
    @Environment(\.cowtailPalette) private var palette
    @State private var range: ItemGraphRange = .sixHours

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let graph = store.graphs[itemID] {
                CowtailSectionHeader(title: graph.query) {
                    rangeControl
                }
                chart(graph)
                HStack(spacing: 8) {
                    label(ItemFormat.when(graph.from, now: graph.to), palette.mutedInk)
                    Spacer(minLength: 0)
                    if let text = graph.firingText {
                        label(text, palette.mutedInk)
                    }
                    label(ItemFormat.when(graph.to, now: graph.to), palette.mutedInk)
                }
                .padding(.bottom, 8)
                .accessibilityHidden(true)
            } else {
                // An empty stack never appears, and its task would never load the graph.
                Color.clear.frame(height: 0).accessibilityHidden(true)
            }
        }
        // Reloads with the range, and every 30 seconds while open, as the item does.
        .task(id: range) {
            while !Task.isCancelled {
                await store.loadGraph(itemID: itemID, range: range)
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    /// The mockup's small segmented control; the system one crowds out a long expression. Each
    /// segment draws small and still takes a 44 × 44 pt hit area.
    private var rangeControl: some View {
        HStack(spacing: 0) {
            ForEach(ItemGraphRange.allCases, id: \.self) { option in
                Button {
                    range = option
                } label: {
                    Text(option.rawValue)
                        .font(.cowtailMono(11, weight: option == range ? .semibold : .regular, relativeTo: .caption))
                        .foregroundStyle(option == range ? palette.ink : palette.mutedInk)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            option == range ? palette.surfaceRaised : .clear,
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                        )
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option == range ? .isSelected : [])
                .accessibilityIdentifier("button.graph-range.\(option.rawValue)")
            }
        }
        .fixedSize()
    }

    private func chart(_ graph: ItemGraph) -> some View {
        Chart {
            if let firing = graph.firing {
                RectangleMark(
                    xStart: .value("Time", max(firing.start, graph.from)),
                    xEnd: .value("Time", min(firing.end ?? graph.to, graph.to))
                )
                .foregroundStyle(palette.accent.opacity(0.16))
            }
            if let threshold = graph.threshold {
                RuleMark(y: .value("Threshold", threshold.value))
                    .foregroundStyle(palette.accent)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .annotation(position: .top, alignment: .leading) {
                        if let text = graph.thresholdText {
                            label(text, palette.accent)
                        }
                    }
            }
            ForEach(Array(graph.series.enumerated()), id: \.offset) { index, series in
                ForEach(series.points, id: \.at) { point in
                    LineMark(x: .value("Time", point.at), y: .value("Value", point.value))
                        .foregroundStyle(by: .value("Series", index))
                        .lineStyle(StrokeStyle(lineWidth: 1.6, lineJoin: .round))
                }
            }
        }
        .chartForegroundStyleScale(range: [palette.ink])
        .chartLegend(.hidden)
        .chartXScale(domain: graph.from...graph.to)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .frame(height: 120)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            [graph.query, graph.thresholdText, graph.firingText].compactMap(\.self).joined(separator: ", ")
        )
        .accessibilityIdentifier("chart.item.graph")
    }

    private func label(_ text: String, _ tint: Color) -> some View {
        Text(text)
            .font(.cowtailMono(9, relativeTo: .caption))
            .foregroundStyle(tint)
    }
}
