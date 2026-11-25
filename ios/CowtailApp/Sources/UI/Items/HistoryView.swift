import SwiftUI

struct HistoryView: View {
    @Environment(CowtailStore.self) private var store
    @EnvironmentObject private var router: UniversalLinkRouter
    @Environment(\.cowtailPalette) private var palette

    @Binding var filter: HistoryFilter
    @State private var isFiltering = false

    var body: some View {
        CowtailScreen(title: "History", identifier: "screen.history", isList: true) {
            EmptyView()
        } actions: {
            CowtailIconButton(title: "Filter", systemImage: "line.3.horizontal.decrease", style: .borderless) {
                isFiltering = true
            }
            .accessibilityIdentifier("button.history.filter")
        } content: {
            chips

            if let error = store.history.error, let receivedAt = store.history.receivedAt {
                RefreshFailureBanner(receivedAt: receivedAt, error: error) { await store.loadHistory(filter) }
            } else if let error = store.history.error {
                Text(error)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
                    .listRowBackground(Color.clear)
            }

            if let stats = store.history.stats {
                outcomes(stats)
                timeToResolve(stats)
            } else {
                Section { roundupRow }
            }
            days
        }
        .searchable(text: $filter.search, placement: .navigationBarDrawer)
        .sheet(isPresented: $isFiltering) {
            HistoryFilterSheet(filter: $filter, sources: store.history.sources)
                .presentationDetents([.medium, .large])
        }
        .task(id: filter) {
            // Typing in the search field settles before the list reloads.
            if !filter.search.isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
            }
            while !Task.isCancelled {
                await store.loadHistory(filter)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .refreshable { await store.loadHistory(filter) }
    }

    @ViewBuilder
    private var chips: some View {
        let active = activeFilters
        if !active.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(active, id: \.key) { chip in
                    Button {
                        chip.clear(&filter)
                    } label: {
                        HStack(spacing: 4) {
                            Text(chip.title)
                            Image(systemName: "xmark").font(.system(.caption2, weight: .bold))
                        }
                        .font(.cowtailMono(11, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(palette.ink)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .overlay(Capsule().stroke(palette.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove filter \(chip.title)")
                    .accessibilityIdentifier("chip.history.\(chip.key)")
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
        }
    }

    private struct FilterChip {
        let key: String
        let title: String
        let clear: (inout HistoryFilter) -> Void
    }

    private var activeFilters: [FilterChip] {
        var chips: [FilterChip] = []
        if let source = filter.source {
            chips.append(FilterChip(key: "source", title: source) { $0.source = nil })
        }
        if let kind = filter.kind {
            chips.append(FilterChip(key: "kind", title: kind.rawValue) { $0.kind = nil })
        }
        if let outcome = filter.outcome {
            chips.append(FilterChip(key: "outcome", title: outcome.label) { $0.outcome = nil })
        }
        if let range = filter.range {
            chips.append(FilterChip(key: "range", title: range.label) { $0.range = nil })
        }
        return chips
    }

    @ViewBuilder
    private func outcomes(_ stats: ItemStats) -> some View {
        // The server's range: with no date filter, it counts the last 7 days.
        Section(
            "Outcomes",
            detail: [
                "\(stats.resolvedCount) resolved",
                stats.from.map { "since \($0.formatted(.dateTime.day().month(.abbreviated)))" },
            ]
            .compactMap { $0 }
            .joined(separator: " · ")
        ) {
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { geometry in
                    HStack(spacing: 2) {
                        ForEach(ItemOutcome.allCases) { outcome in
                            let count = stats.outcomeMix[outcome] ?? 0
                            if count > 0, stats.resolvedCount > 0 {
                                Rectangle()
                                    .fill(outcome.tint(palette))
                                    .frame(width: max(2, geometry.size.width * Double(count) / Double(stats.resolvedCount) - 2))
                            }
                        }
                    }
                }
                .frame(height: 8)
                .clipShape(Capsule())

                FlowLayout(spacing: 10) {
                    ForEach(ItemOutcome.allCases) { outcome in
                        HStack(spacing: 4) {
                            Circle().fill(outcome.tint(palette)).frame(width: 7, height: 7)
                            Text("\(outcome.label) \(stats.outcomeMix[outcome] ?? 0)")
                                .font(.cowtailMono(11, relativeTo: .caption))
                                .foregroundStyle(palette.mutedInk)
                        }
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("chart.history.outcomes")
        }
    }

    @ViewBuilder
    private func timeToResolve(_ stats: ItemStats) -> some View {
        Section("Time to resolve", detail: "median · p90") {
            ForEach(stats.timeToResolve, id: \.kind) { row in
                keyValue(row.kind.rawValue, "\(ItemFormat.duration(row.median)) · \(ItemFormat.duration(row.p90))")
            }
            keyValue("Noise rate", ItemFormat.percent(stats.noiseRate))
                .accessibilityIdentifier("row.history.noise-rate")
            roundupRow
        }
    }

    private var roundupRow: some View {
        CowtailRouteLink(value: AppRoute.roundup(router.roundupRoute)) {
            HStack {
                Text("Roundup")
                    .font(.cowtailSans(14, weight: .medium, relativeTo: .body))
                Spacer()
                Text(router.roundupRoute.from)
                    .font(.cowtailMono(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
            }
        }
        .accessibilityIdentifier("row.history.roundup")
    }

    /// The server's days, in the server's order.
    private var dayGroups: [(date: String, items: [Item])] {
        var groups: [(date: String, items: [Item])] = []
        for item in store.history.items {
            let date = item.createdDate ?? ""
            if groups.last?.date == date {
                groups[groups.count - 1].items.append(item)
            } else {
                groups.append((date, [item]))
            }
        }
        return groups
    }

    @ViewBuilder
    private var days: some View {
        ForEach(dayGroups, id: \.date) { group in
            Section(Self.dayLabel(group.date), detail: store.history.dayCounts[group.date].map(String.init)) {
                ForEach(group.items) { item in
                    ItemRow(item: item, style: .history)
                        .onAppear {
                            if item.id == store.history.items.last?.id, store.history.hasMore {
                                Task { await store.loadMoreHistory() }
                            }
                        }
                }
            }
        }
        if store.history.hasMore {
            CowtailIconButton(title: "Load older items", systemImage: "arrow.down") {
                Task { await store.loadMoreHistory() }
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
            .accessibilityIdentifier("button.history.load-more")
        }
    }

    private static func dayLabel(_ date: String) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.dateFormat = "yyyy-MM-dd"
        guard let day = parser.date(from: date) else { return date }
        return day.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    private func keyValue(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).font(.cowtailSans(14, relativeTo: .body))
            Spacer()
            Text(value)
                .font(.cowtailMono(12, relativeTo: .caption))
                .foregroundStyle(palette.ink)
        }
    }
}

struct HistoryFilterSheet: View {
    @Binding var filter: HistoryFilter
    let sources: [String]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Source", selection: $filter.source) {
                    Text("Any").tag(String?.none)
                    ForEach(sources, id: \.self) { Text($0).tag(Optional($0)) }
                }
                .accessibilityIdentifier("picker.history.source")
                Picker("Kind", selection: $filter.kind) {
                    Text("Any").tag(ItemKind?.none)
                    ForEach(ItemKind.allCases) { Text($0.rawValue).tag(Optional($0)) }
                }
                .accessibilityIdentifier("picker.history.kind")
                Picker("Outcome", selection: $filter.outcome) {
                    Text("Any").tag(ItemOutcome?.none)
                    ForEach(ItemOutcome.allCases) { Text($0.label).tag(Optional($0)) }
                }
                .accessibilityIdentifier("picker.history.outcome")
                Picker("Date range", selection: $filter.range) {
                    Text("All time").tag(HistoryFilter.Range?.none)
                    ForEach(HistoryFilter.Range.allCases) { Text($0.label).tag(Optional($0)) }
                }
                .accessibilityIdentifier("picker.history.range")
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("button.history.filter-done")
                }
            }
        }
    }
}
