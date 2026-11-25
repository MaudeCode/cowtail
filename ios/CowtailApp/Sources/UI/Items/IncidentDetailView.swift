import SwiftUI

/// An incident opened by its ID: loads it now and every 30 seconds while open.
struct IncidentDestinationView: View {
    let id: String

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        Group {
            if let detail = store.incidents[id] {
                IncidentDetailView(detail: detail)
            } else if let error = store.incidentErrors[id] {
                CowtailScreen(title: "Incident", identifier: "screen.incident-missing", titleDisplayMode: .inline) {
                    Text(error)
                        .font(.cowtailSans(15, relativeTo: .body))
                        .foregroundStyle(palette.mutedInk)
                        .padding(.top, 12)
                }
            } else {
                CowtailCanvas {
                    ProgressView()
                        .accessibilityIdentifier("progress.incident")
                }
            }
        }
        .task(id: id) {
            while !Task.isCancelled {
                await store.loadIncident(id: id)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .refreshable { await store.loadIncident(id: id) }
    }
}

/// Header, merged timeline, postmortem and members, stacked in that order.
struct IncidentDetailView: View {
    let detail: IncidentDetail

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette
    @State private var isAdding = false

    private var incident: Incident { detail.incident }
    private var summary: IncidentSummary { incident.summary }

    var body: some View {
        CowtailScreen(title: "", identifier: "screen.incident-detail", titleDisplayMode: .inline) {
            EmptyView()
        } actions: {
            actions
        } content: {
            header
            ItemTimeline(events: detail.events)
            postmortem
            members
        }
        .sheet(isPresented: $isAdding) {
            AddIncidentItemSheet(incidentID: summary.id)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                ItemSourceIcon(symbol: "square.3.layers.3d", name: "Incident")
                VStack(alignment: .leading, spacing: 3) {
                    Text("Incident · \(summary.span)")
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.mutedInk)
                    Text(summary.title)
                        .font(.cowtailSans(18, weight: .bold, relativeTo: .title3))
                        .foregroundStyle(palette.ink)
                        .accessibilityIdentifier("text.incident.title")
                }
            }

            FlowLayout(spacing: 6) {
                CowtailStatusBadge(title: summary.state.rawValue, tint: summary.state.tint(palette))
                CowtailStatusBadge(title: summary.memberCountText)
                if let worst = summary.worstUrgency {
                    CowtailStatusBadge(title: worst.rawValue, tint: worst.tint(palette))
                }
                CowtailStatusBadge(title: ItemFormat.duration(summary.duration))
            }
            .padding(.top, 4)

            if let error = store.incidentErrors[summary.id] {
                Text(error)
                    .font(.cowtailSans(12, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
                    .accessibilityIdentifier("text.incident.error")
            }
        }
        .padding(.top, 8)
    }

    /// The page's actions, in the navigation bar.
    @ViewBuilder
    private var actions: some View {
        CowtailIconButton(
            title: "Add an item",
            systemImage: "plus",
            style: .borderless,
            isBusy: store.isAddingItem(to: summary.id)
        ) {
            isAdding = true
        }
        .accessibilityIdentifier("button.incident.add")
        CowtailIconButton(title: "Request postmortem again", systemImage: "arrow.clockwise", style: .borderless) {
            Task { await store.change(.requestPostmortem, incidentID: summary.id) }
        }
        .disabled(!incident.availableActions.contains(.requestPostmortem))
        .accessibilityIdentifier("button.incident.postmortem")
        if incident.availableActions.contains(.resolve) {
            CowtailIconButton(title: "Resolve", systemImage: "checkmark", style: .borderless) {
                Task { await store.change(.resolve, incidentID: summary.id) }
            }
            .accessibilityIdentifier("button.incident.resolve")
        }
    }

    @ViewBuilder
    private var postmortem: some View {
        CowtailSectionHeader(
            title: "Postmortem",
            detail: incident.postmortemAt.map { "Hermes · \(ItemFormat.time($0))" }
        )
        if let text = incident.postmortem {
            PostmortemText(markdown: text)
                .padding(.vertical, 8)
                .accessibilityIdentifier("text.incident.postmortem")
        } else {
            Text(incident.postmortemState.waitingText)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(palette.mutedInk)
                .cowtailRow()
        }
    }

    @ViewBuilder
    private var members: some View {
        CowtailSectionHeader(title: "Members", detail: "\(summary.memberCount)")
        ForEach(detail.members) { member in
            HStack(spacing: 10) {
                NavigationLink(value: AppRoute.item(member.id)) {
                    Text(member.subtitle.map { "\(member.title) · \($0)" } ?? member.title)
                        .font(.cowtailSans(14, relativeTo: .body))
                        .foregroundStyle(palette.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("link.member.\(member.id)")
                if let outcome = member.outcome {
                    CowtailStatusBadge(title: outcome.label, tint: outcome.tint(palette))
                } else {
                    CowtailStatusBadge(title: member.state.rawValue, tint: member.state.tint(palette))
                }
                CowtailIconButton(title: "Remove from incident", systemImage: "xmark", role: .destructive) {
                    Task { await store.change(.remove(itemID: member.id), incidentID: summary.id) }
                }
                .accessibilityIdentifier("button.incident.remove.\(member.id)")
            }
            .cowtailRow()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("row.member.\(member.id)")
        }
    }
}

/// Hermes's postmortem: headings, paragraphs and list items, each line's inline Markdown
/// (bold, italics, code, links) rendered by Foundation.
struct PostmortemText: View {
    let markdown: String

    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(Self.blocks(markdown).enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let text):
                    Text(Self.inline(text))
                        .font(.cowtailSans(14, weight: .bold, relativeTo: .subheadline))
                        .foregroundStyle(palette.ink)
                        .padding(.top, 6)
                case .item(let marker, let text):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(marker)
                        Text(Self.inline(text))
                    }
                    .font(.cowtailSans(14, relativeTo: .body))
                    .foregroundStyle(palette.ink)
                case .paragraph(let text):
                    Text(Self.inline(text))
                        .font(.cowtailSans(14, relativeTo: .body))
                        .foregroundStyle(palette.ink)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    enum Block: Equatable {
        case heading(String)
        case item(marker: String, text: String)
        case paragraph(String)
    }

    /// One block per heading and list item, and per run of other lines.
    static func blocks(_ markdown: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: " ")))
            }
            paragraph = []
        }
        for raw in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                flush()
            } else if let match = line.firstMatch(of: /^#{1,6}\s+(.*)$/) {
                flush()
                blocks.append(.heading(String(match.1)))
            } else if let match = line.firstMatch(of: /^[-*+]\s+(.*)$/) {
                flush()
                blocks.append(.item(marker: "•", text: String(match.1)))
            } else if let match = line.firstMatch(of: /^(\d+)[.)]\s+(.*)$/) {
                flush()
                blocks.append(.item(marker: "\(match.1).", text: String(match.2)))
            } else {
                paragraph.append(line)
            }
        }
        flush()
        return blocks
    }

    private static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

/// The items the server says can join, each a choice that adds it.
struct AddIncidentItemSheet: View {
    let incidentID: String

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var candidates: [Item]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            CowtailCanvas {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        CowtailSectionHeader(title: "Add an item")
                        if let error {
                            Text(error)
                                .font(.cowtailSans(12, relativeTo: .footnote))
                                .foregroundStyle(palette.accent)
                        }
                        if candidates?.isEmpty == true {
                            Text("No item to add.")
                                .font(.cowtailSans(13, relativeTo: .footnote))
                                .foregroundStyle(palette.mutedInk)
                                .cowtailRow()
                        }
                        ForEach(candidates ?? []) { item in
                            Button {
                                dismiss()
                                Task { await store.change(.add(itemID: item.id), incidentID: incidentID) }
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    ItemSourceIcon(item: item)
                                    Text(item.title)
                                        .font(.cowtailSans(14, relativeTo: .body))
                                        .foregroundStyle(palette.ink)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    Text(ItemFormat.time(item.createdAt))
                                        .font(.cowtailMono(11, relativeTo: .caption))
                                        .foregroundStyle(palette.mutedInk)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .cowtailRow()
                            .accessibilityIdentifier("row.candidate.\(item.id)")
                        }
                    }
                    .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            do {
                candidates = try await store.incidentCandidates(id: incidentID)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
