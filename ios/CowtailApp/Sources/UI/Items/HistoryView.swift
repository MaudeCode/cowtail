import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var store: CowtailStore
    @EnvironmentObject private var router: UniversalLinkRouter
    @Environment(\.cowtailPalette) private var palette

    @State private var filter = HistoryFilter()
    @State private var isFiltering = false

    var body: some View {
        CowtailScreen(title: "History", identifier: "screen.history") {
            searchBar
            chips

            if let error = store.historyError {
                Text(error)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
                    .padding(.top, 8)
            }

            if let stats = store.historyStats {
                outcomes(stats)
                timeToResolve(stats)
            }
            roundupRow
            days
        }
        .sheet(isPresented: $isFiltering) {
            HistoryFilterSheet(filter: $filter, sources: sources)
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

    private var searchBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(palette.mutedInk)
                TextField("Search", text: $filter.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .accessibilityIdentifier("field.history.search")
            }
            .font(.cowtailSans(14, relativeTo: .body))
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(palette.border, lineWidth: 1))

            CowtailIconButton(title: "Filter", systemImage: "line.3.horizontal.decrease") {
                isFiltering = true
            }
            .accessibilityIdentifier("button.history.filter")
        }
        .padding(.top, 8)
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
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                        }
                        .font(.cowtailMono(11, weight: .medium, relativeTo: .caption2))
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
            .padding(.top, 8)
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

    /// The sources the server counted in the stats range, and the one already picked.
    private var sources: [String] {
        let counted = store.historyStats?.dailyVolume.flatMap(\.bySource.keys) ?? []
        return Array(Set(counted + [filter.source].compactMap { $0 })).sorted()
    }

    @ViewBuilder
    private func outcomes(_ stats: ItemStats) -> some View {
        CowtailSectionHeader(title: "Outcomes", detail: "\(stats.resolvedCount) resolved")
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
                            .font(.cowtailMono(11, relativeTo: .caption2))
                            .foregroundStyle(palette.mutedInk)
                    }
                }
            }
        }
        .cowtailRow()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chart.history.outcomes")
    }

    @ViewBuilder
    private func timeToResolve(_ stats: ItemStats) -> some View {
        CowtailSectionHeader(title: "Time to resolve", detail: "median · p90")
        ForEach(stats.timeToResolve, id: \.kind) { row in
            keyValue(row.kind.rawValue, "\(ItemFormat.duration(row.median)) · \(ItemFormat.duration(row.p90))")
        }
        keyValue("Noise rate", ItemFormat.percent(stats.noiseRate))
            .accessibilityIdentifier("row.history.noise-rate")
    }

    private var roundupRow: some View {
        NavigationLink(value: AppRoute.roundup(router.roundupRoute)) {
            HStack {
                Text("Roundup")
                    .font(.cowtailSans(14, weight: .medium, relativeTo: .body))
                Spacer()
                Text(router.roundupRoute.from)
                    .font(.cowtailMono(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(palette.mutedInk)
            }
            .contentShape(Rectangle())
            .cowtailRow()
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("row.history.roundup")
        .padding(.top, 10)
    }

    @ViewBuilder
    private var days: some View {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: store.historyItems) { calendar.startOfDay(for: $0.createdAt) }
        ForEach(groups.keys.sorted(by: >), id: \.self) { day in
            let items = groups[day] ?? []
            CowtailSectionHeader(
                title: day.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)),
                detail: "\(items.count)"
            )
            ForEach(items) { item in
                ItemRow(item: item, style: .history)
                    .onAppear {
                        if item.id == store.historyItems.last?.id, store.hasMoreHistory {
                            Task { await store.loadMoreHistory() }
                        }
                    }
            }
        }
    }

    private func keyValue(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).font(.cowtailSans(14, relativeTo: .body))
            Spacer()
            Text(value)
                .font(.cowtailMono(12, relativeTo: .caption))
                .foregroundStyle(palette.ink)
        }
        .cowtailRow()
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
