import SwiftUI

/// An item opened by its ID, or by the alert it belongs to.
struct ItemDestinationView: View {
    let route: AppRoute

    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        Group {
            if let itemID, let detail = store.details[itemID] {
                ItemDetailView(detail: detail)
            } else if let error = store.detailErrors[routeKey] ?? itemID.flatMap({ store.detailErrors[$0] }) {
                CowtailScreen(title: "Item", identifier: "screen.item-missing") {
                    Text(error)
                        .font(.cowtailSans(15, relativeTo: .body))
                        .foregroundStyle(palette.mutedInk)
                        .padding(.top, 12)
                }
            } else {
                CowtailCanvas {
                    ProgressView()
                        .accessibilityIdentifier("progress.item")
                }
            }
        }
        // Reloads every 30 seconds while open, on a push and when the app returns.
        .task(id: route) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .refreshable {
            await load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .cowtailPushReceived)) { _ in
            Task { await load() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await load() }
            }
        }
    }

    private var routeKey: String {
        switch route {
        case .item(let id), .alert(let id): id
        case .roundup: ""
        }
    }

    private var itemID: String? {
        switch route {
        case .item(let id): id
        case .alert(let alertID): store.itemIDsByAlertID[alertID]
        case .roundup: nil
        }
    }

    private func load() async {
        switch route {
        case .item(let id): await store.loadDetail(itemID: id)
        case .alert(let alertID): await store.loadDetail(alertID: alertID)
        case .roundup: break
        }
    }
}

struct ItemDetailView: View {
    let detail: ItemDetail

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    private var item: Item { detail.item }

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    timeline
                    details
                }
                .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                .padding(.bottom, 28)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.item-detail")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.sourceName)
                .font(.cowtailSans(12, relativeTo: .caption))
                .foregroundStyle(palette.mutedInk)
            Text(item.title)
                .font(.cowtailSans(18, weight: .bold, relativeTo: .title3))
                .foregroundStyle(palette.ink)
                .accessibilityIdentifier("text.item.title")
            if let subtitle = item.subtitle {
                Text(subtitle)
                    .font(.cowtailMono(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
            }

            FlowLayout(spacing: 6) {
                CowtailStatusBadge(title: item.kind.rawValue)
                CowtailStatusBadge(title: item.urgency.rawValue, tint: item.urgency.tint(palette))
                CowtailStatusBadge(title: item.state.rawValue, tint: item.state.tint(palette))
                if item.occurrenceCount > 1 {
                    CowtailStatusBadge(title: "×\(item.occurrenceCount)")
                }
                ItemActionButtons(item: item, includesAlertActions: true)
            }
            .padding(.top, 4)

            ItemChoiceButtons(item: item)

            if let error = store.actionErrors[item.id] {
                Text(error)
                    .font(.cowtailSans(12, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
            }
        }
        .padding(.top, 8)
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 0) {
            CowtailSectionHeader(title: "Timeline")
            ForEach(detail.events) { event in
                HStack(alignment: .top, spacing: 10) {
                    Circle()
                        .fill(event.tint(palette))
                        .frame(width: 7, height: 7)
                        .padding(.top, 5)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.type.rawValue)
                            .font(.cowtailMono(11, weight: .medium, relativeTo: .caption2))
                            .foregroundStyle(event.tint(palette))
                        if !event.text.isEmpty {
                            Text(event.text)
                                .font(.cowtailSans(13, relativeTo: .footnote))
                                .foregroundStyle(palette.ink)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(ItemFormat.time(event.at))
                        .font(.cowtailMono(11, relativeTo: .caption2))
                        .foregroundStyle(palette.mutedInk)
                }
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("event.\(event.type.rawValue)")
            }
        }
    }

    @ViewBuilder
    private var details: some View {
        CowtailSectionHeader(title: "Details")
        if !item.body.isEmpty {
            Text(markdown(item.body))
                .font(.cowtailSans(14, relativeTo: .body))
                .foregroundStyle(palette.ink)
                .padding(.vertical, 8)
        }
        if let rootCause = item.rootCause {
            result("Root cause", rootCause)
        }
        if let actionTaken = item.actionTaken {
            result("Action", actionTaken)
        }
        if !item.context.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(item.contextOrder, id: \.self) { key in
                    CowtailStatusBadge(title: "\(key)=\(item.context[key] ?? "")")
                }
            }
            .padding(.vertical, 6)
        }
        ForEach(item.links, id: \.self) { link in
            Link(destination: link.url) {
                HStack {
                    Text(link.label)
                        .font(.cowtailSans(14, relativeTo: .body))
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundStyle(palette.ink)
            }
            .cowtailRow()
        }
    }

    private func result(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            CowtailMonoLabel(text: title)
            Text(text)
                .font(.cowtailSans(14, relativeTo: .body))
                .foregroundStyle(palette.ink)
        }
        .cowtailRow()
    }

    private func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }
}

/// Lays chips out left to right, wrapping to the next line.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                let y = bounds.minY + row.y + (row.height - size.height) / 2
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: .init(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var y: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > width {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            let gap = rows[rows.count - 1].indices.isEmpty ? 0 : spacing
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
