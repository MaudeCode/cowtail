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
                CowtailScreen(title: "Item", identifier: "screen.item-missing", titleDisplayMode: .inline) {
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
        case .incident, .roundup, .settings: ""
        }
    }

    private var itemID: String? {
        switch route {
        case .item(let id): id
        case .alert(let alertID): store.itemIDsByAlertID[alertID]
        case .incident, .roundup, .settings: nil
        }
    }

    private func load() async {
        switch route {
        case .item(let id): await store.loadDetail(itemID: id)
        case .alert(let alertID): await store.loadDetail(alertID: alertID)
        case .incident, .roundup, .settings: break
        }
    }
}

struct ItemDetailView: View {
    let detail: ItemDetail

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    private var item: Item { detail.item }

    /// Answer first: the header, the details and fix, then the timeline, graph and past
    /// occurrences. The actions are pinned above the tab bar and never scroll away.
    var body: some View {
        CowtailScreen(title: "", identifier: "screen.item-detail", titleDisplayMode: .inline) {
            header
            details
            fixes
            ItemTimeline(events: detail.events)
            ItemGraphSection(itemID: item.id)
            priorOccurrences
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !item.availableActions.isEmpty || !item.alertActions.isEmpty || store.actionErrors[item.id] != nil {
                actionArea
            }
        }
    }

    /// The text actions (a question's answers, a script), then the icon actions and the owner's
    /// alert calls, wrapping to the next line rather than clipping.
    private var actionArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            ItemTextButtons(item: item)
            ItemActionButtons(item: item, isActionArea: true)
            if let error = store.actionErrors[item.id] {
                Text(error)
                    .font(.cowtailSans(12, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
        .padding(.vertical, 8)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("area.item.actions")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                ItemSourceIcon(item: item)
                VStack(alignment: .leading, spacing: 3) {
                    // The icon already reads as the source's name.
                    Text(item.sourceName)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.mutedInk)
                        .accessibilityHidden(true)
                    Text(item.title)
                        .font(.cowtailSans(18, weight: .bold, relativeTo: .title3))
                        .foregroundStyle(palette.ink)
                        .accessibilityIdentifier("text.item.title")
                    if let subtitle = item.subtitle {
                        Text(subtitle)
                            .font(.cowtailMono(12, relativeTo: .caption))
                            .foregroundStyle(palette.mutedInk)
                    }
                }
            }

            FlowLayout(spacing: 6) {
                CowtailStatusBadge(title: item.kind.rawValue)
                CowtailStatusBadge(title: item.urgency.rawValue, tint: item.urgency.tint(palette))
                CowtailStatusBadge(title: item.state.rawValue, tint: item.state.tint(palette))
                if item.occurrenceCount > 1 {
                    CowtailStatusBadge(title: "×\(item.occurrenceCount)")
                }
                if let incident = item.incident {
                    NavigationLink(value: AppRoute.incident(incident.id)) {
                        CowtailStatusBadge(title: incident.title, systemImage: "square.3.layers.3d")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open incident \(incident.title)")
                    .accessibilityIdentifier("chip.item.incident")
                }
            }
            .padding(.top, 4)
        }
        .padding(.top, 8)
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
        if let ownerNote = item.ownerNote {
            result("Your note", ownerNote)
        }
        if !item.context.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(item.contextOrder, id: \.self) { key in
                    CowtailStatusBadge(title: "\(key)=\(item.context[key] ?? "")")
                }
            }
            .padding(.vertical, 6)
        }
        ForEach(links, id: \.self) { link in
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

    /// The item's links, and for an alert its page on Cowtail Web, as the alert screen had.
    private var links: [ItemLink] {
        let web = item.alertID.flatMap(AppConfig.alertDetailURL(for:)).map { ItemLink(label: "Cowtail Web", url: $0) }
        return item.links + [web].compactMap { $0 }
    }

    /// The mockup's order: details, then the fixes recorded for the alert.
    @ViewBuilder
    private var fixes: some View {
        if !detail.fixes.isEmpty {
            CowtailSectionHeader(title: "Fix", detail: "\(detail.fixes.count)")
            ForEach(detail.fixes) { fix in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        CowtailStatusBadge(title: fix.scope.rawValue, tint: fix.scope.tint)
                        Spacer()
                        Text(fix.timestamp.formatted(date: .abbreviated, time: .shortened))
                            .font(.cowtailMono(11, relativeTo: .caption2))
                            .foregroundStyle(palette.mutedInk)
                    }
                    Text(fix.description)
                        .font(.cowtailSans(14, relativeTo: .body))
                        .foregroundStyle(palette.ink)
                    Text(fix.rootCause)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.mutedInk)
                }
                .cowtailRow()
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// The mockup's last section: earlier firings of the alert, newest first.
    @ViewBuilder
    private var priorOccurrences: some View {
        if !detail.priorOccurrences.isEmpty {
            CowtailSectionHeader(title: "Past occurrences")
            ForEach(detail.priorOccurrences) { prior in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(ItemFormat.day(prior.firedAt))
                        .font(.cowtailMono(11, relativeTo: .caption2))
                        .foregroundStyle(palette.mutedInk)
                    CowtailStatusBadge(title: prior.outcome.label, tint: prior.outcome.tint(palette))
                    Text(prior.cause)
                        .font(.cowtailSans(13, relativeTo: .footnote))
                        .foregroundStyle(palette.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(prior.fixCommitText)
                        .font(.cowtailMono(11, relativeTo: .caption2))
                        .foregroundStyle(palette.mutedInk)
                }
                .cowtailRow()
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("row.prior-occurrence.\(prior.id)")
            }
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

/// An item's timeline, or an incident's merged one, whose events name the member they concern.
struct ItemTimeline: View {
    let events: [ItemEvent]

    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CowtailSectionHeader(title: "Timeline")
            ForEach(events) { event in
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 10) {
                        Circle()
                            .fill(event.tint(palette))
                            .frame(width: 7, height: 7)
                            .padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.heading)
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
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("event.\(event.type.rawValue)")
                    if !event.evidence.isEmpty {
                        evidence(event)
                            .padding(.leading, 17)
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }

    /// The steps behind a Hermes update, collapsed: each a numbered line, then its command and
    /// output in one monospace block.
    private func evidence(_ event: ItemEvent) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(event.evidence.enumerated()), id: \.offset) { index, step in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(step.line(index + 1))
                            .font(.cowtailSans(12, relativeTo: .caption))
                            .foregroundStyle(palette.mutedInk)
                        if let block = step.block {
                            Text(block)
                                .font(.cowtailMono(11, relativeTo: .caption2))
                                .foregroundStyle(palette.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 7)
                                .background(palette.surface)
                                .overlay(alignment: .leading) {
                                    Rectangle().fill(palette.border).frame(width: 2)
                                }
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .padding(.top, 6)
        } label: {
            Text(event.evidenceTitle)
                .font(.cowtailSans(12, relativeTo: .caption))
                .foregroundStyle(palette.mutedInk)
        }
        .tint(palette.mutedInk)
        .padding(.top, 4)
    }
}
