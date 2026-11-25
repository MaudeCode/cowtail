import SwiftUI

/// One item in a list: Inbox, History or an incident's members. The whole row opens the item; its
/// actions are swipe actions and a context menu. The style picks the second line and what ends
/// the row.
struct ItemRow: View {
    enum Style: Equatable {
        case needsYou
        case withHermes
        case upcoming
        case history
        /// A member of the incident, whose menu can take it out.
        case member(incidentID: String)
    }

    let item: Item
    let style: Style

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        // A list shows an incident's members as one row, except the incident's own page.
        if let incident = item.incident, !isMember {
            IncidentRow(incident: incident)
        } else {
            ItemActions(item: item) { run in
                let buttons = ItemButton.buttons(for: item)
                let trailing = ItemButton.trailingSwipe(buttons)
                link
                    // Without Acknowledge a full swipe takes nothing, so it cannot snooze by accident.
                    .swipeActions(edge: .trailing, allowsFullSwipe: trailing.first == .ack) {
                        ForEach(trailing) { swipeButton($0, run: run) }
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        ForEach(ItemButton.leadingSwipe(buttons)) { swipeButton($0, run: run) }
                    }
                    .contextMenu {
                        Section {
                            ForEach(buttons.filter { !$0.isAlertCall }) { menuButton($0, run: run) }
                        }
                        Section {
                            ForEach(buttons.filter(\.isAlertCall)) { menuButton($0, run: run) }
                        }
                        if case .member(let incidentID) = style {
                            Button("Remove from incident", systemImage: "rectangle.stack.badge.minus", role: .destructive) {
                                Task { await store.change(.remove(itemID: item.id), incidentID: incidentID) }
                            }
                            .accessibilityIdentifier("button.incident.remove.\(item.id)")
                        }
                    }
            }
        }
    }

    private var isMember: Bool {
        if case .member = style {
            return true
        }
        return false
    }

    private func swipeButton(_ button: ItemButton, run: @escaping (ItemButton) -> Void) -> some View {
        Button(button.title, systemImage: button.systemImage, role: button.role) { run(button) }
            .tint(button.swipeTint(palette))
            .accessibilityIdentifier(button.accessibilityIdentifier(itemID: item.id))
    }

    private func menuButton(_ button: ItemButton, run: @escaping (ItemButton) -> Void) -> some View {
        Button(button.title, systemImage: button.systemImage, role: button.role) { run(button) }
            .accessibilityIdentifier(button.accessibilityIdentifier(itemID: item.id))
    }

    private var link: some View {
        CowtailRouteLink(value: AppRoute.item(item.id)) {
            HStack(alignment: .top, spacing: 10) {
                ItemSourceIcon(item: item)
                VStack(alignment: .leading, spacing: 3) {
                    summary
                    if let error = store.actionErrors[item.id] {
                        Text(error)
                            .font(.cowtailSans(12, relativeTo: .footnote))
                            .foregroundStyle(palette.accent)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                trailing
            }
        }
        .accessibilityIdentifier("row.item.\(item.id)")
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(item.title)
                    .font(.cowtailSans(15, weight: .medium, relativeTo: .subheadline))
                    .foregroundStyle(palette.ink)
                    .lineLimit(2)
                if item.occurrenceCount > 1 {
                    CowtailStatusBadge(title: "×\(item.occurrenceCount)")
                }
                if item.maintenanceWindowID != nil, style == .history {
                    Image(systemName: "wrench.adjustable")
                        .font(.caption2)
                        .foregroundStyle(palette.mutedInk)
                        .accessibilityLabel("Recorded during a maintenance window")
                        .accessibilityIdentifier("glyph.item.maintenance.\(item.id)")
                }
            }

            if style == .needsYou || style == .withHermes, let subtitle = item.subtitle {
                Text(subtitle)
                    .font(.cowtailMono(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
                    .lineLimit(1)
            }

            meta
                .font(.cowtailSans(12, relativeTo: .caption))
                .foregroundStyle(palette.mutedInk)
                .lineLimit(2)
        }
    }

    @ViewBuilder
    private var meta: some View {
        switch style {
        case .needsYou:
            Text("\(item.sourceName) · \(item.kind.rawValue) · \(Text(needsYouStatus).foregroundStyle(item.urgency.tint(palette)))")
        case .withHermes:
            if let update = item.latestUpdate {
                Text("\(Text("Hermes").foregroundStyle(palette.info)) \(update.text) · \(ItemFormat.age(of: update.at))")
            } else {
                Text("\(item.sourceName) · \(item.kind.rawValue) · \(item.investigationStep?.label ?? item.state.rawValue)")
            }
        case .upcoming:
            Text(item.snoozedUntil.map { ItemFormat.returnTime($0) } ?? item.state.rawValue)
        case .history:
            Text(
                [
                    item.subtitle ?? item.sourceName,
                    ItemFormat.time(item.createdAt),
                    item.resolvedAfter.map { ItemFormat.duration($0) },
                ]
                .compactMap { $0 }
                .joined(separator: " · ")
            )
        case .member:
            Text("\(item.subtitle ?? item.sourceName) · \(ItemFormat.time(item.createdAt))")
        }
    }

    private var needsYouStatus: String {
        if let step = item.investigationStep {
            return step.label
        }
        if let expiresAt = item.expiresAt {
            return "expires in \(ItemFormat.age(of: .now, now: expiresAt))"
        }
        return item.urgency.rawValue
    }

    /// History ends a row with how the item ended.
    @ViewBuilder
    private var trailing: some View {
        if style == .history {
            if let outcome = item.outcome {
                CowtailStatusBadge(title: outcome.label, tint: outcome.tint(palette))
            } else {
                CowtailStatusBadge(title: item.state.rawValue, tint: item.state.tint(palette))
            }
        }
    }
}

/// The row that stands for a whole incident in any section; it opens the incident.
struct IncidentRow: View {
    let incident: IncidentSummary

    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        CowtailRouteLink(value: AppRoute.incident(incident.id)) {
            HStack(alignment: .top, spacing: 10) {
                ItemSourceIcon(symbol: "square.3.layers.3d", name: "Incident")
                VStack(alignment: .leading, spacing: 3) {
                    Text(incident.title)
                        .font(.cowtailSans(15, weight: .medium, relativeTo: .subheadline))
                        .foregroundStyle(palette.ink)
                        .lineLimit(2)
                    incident.line(palette)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.mutedInk)
                }
            }
        }
        .accessibilityIdentifier("row.incident.\(incident.id)")
    }
}

/// The item's source: its uploaded icon in a small rounded square, or the source's symbol.
/// VoiceOver reads it as the source's display name, so a row starts with who sent it. An
/// incident shows its own symbol.
struct ItemSourceIcon: View {
    let iconURL: URL?
    let symbol: String
    let name: String

    init(item: Item) {
        self.init(iconURL: item.sourceIconURL, symbol: item.sourceSymbol, name: item.sourceName)
    }

    init(iconURL: URL? = nil, symbol: String, name: String) {
        self.iconURL = iconURL
        self.symbol = symbol
        self.name = name
    }

    @Environment(\.cowtailPalette) private var palette

    private static let size: CGFloat = 22

    var body: some View {
        AsyncImage(url: iconURL) { phase in
            if let image = phase.image {
                labeled(image.resizable().scaledToFill(), identifier: "icon.source.image")
            } else {
                labeled(
                    Image(systemName: symbol)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(palette.mutedInk),
                    identifier: "icon.source.symbol"
                )
            }
        }
        .frame(width: Self.size, height: Self.size)
        .background(palette.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    /// A loaded image has no accessibility of its own, so each phase is one image named for the source.
    private func labeled(_ icon: some View, identifier: String) -> some View {
        icon
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(name)
            .accessibilityAddTraits(.isImage)
            .accessibilityIdentifier(identifier)
    }
}

/// Runs an item's buttons wherever they show: the item page, a row's swipe actions and its
/// context menu. It holds what a button opens before the write: the snooze sheet, the reply
/// and note alerts, and a script's prompt.
struct ItemActions<Content: View>: View {
    let item: Item
    @ViewBuilder let content: (_ run: @escaping (ItemButton) -> Void) -> Content

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.openURL) private var openURL
    @State private var isSnoozing = false
    @State private var isReplying = false
    @State private var replyText = ""
    @State private var noteAction: AlertHumanAction?
    @State private var noteText = ""
    @State private var confirming: RunbookScript?

    var body: some View {
        content(run)
            .sheet(isPresented: $isSnoozing) {
                SnoozeSheet(load: { try await store.snoozeOptions() }) { until in
                    Task { await store.perform(.snooze(until: until), on: item) }
                }
            }
            .alert("Reply", isPresented: $isReplying) {
                TextField("Reply", text: $replyText)
                Button("Send") {
                    let text = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
                    replyText = ""
                    guard !text.isEmpty else { return }
                    Task { await store.perform(.reply(text), on: item) }
                }
                Button("Cancel", role: .cancel) {
                    replyText = ""
                }
            }
            .alert(
                noteAction.map(Self.title) ?? "",
                isPresented: Binding(get: { noteAction != nil }, set: {
                    if !$0 {
                        noteAction = nil
                    }
                })
            ) {
                TextField("Note (optional)", text: $noteText)
                if let action = noteAction {
                    Button(Self.title(action)) {
                        let note = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                        noteText = ""
                        Task { await store.perform(action, note: note.isEmpty ? nil : note, on: item) }
                    }
                }
                Button("Cancel", role: .cancel) {
                    noteText = ""
                }
            }
            .runbookConfirmation($confirming) { script in
                Task { await store.startRun(script, itemID: item.id) }
            }
    }

    private static func title(_ action: AlertHumanAction) -> String {
        switch action {
        case .markNoise: ItemButton.markNoise.title
        case .escalate: ItemButton.escalate.title
        case .retryInvestigation: ItemButton.retryInvestigation.title
        }
    }

    private func run(_ button: ItemButton) {
        switch button {
        case .approve:
            Task { await store.perform(.approve, on: item) }
        case .deny:
            Task { await store.perform(.deny, on: item) }
        case .ack:
            Task { await store.perform(.ack, on: item) }
        case .snooze:
            isSnoozing = true
        case .unsnooze:
            Task { await store.perform(.unsnooze, on: item) }
        case .reply:
            isReplying = true
        case .choose(let option):
            Task { await store.perform(.choose(option), on: item) }
        case .open(let url):
            openURL(url)
        case .run(let script):
            if script.asksToConfirm {
                confirming = script
            } else {
                Task { await store.startRun(script, itemID: item.id) }
            }
        // The owner's call on an alert takes an optional note, as it always has.
        case .markNoise:
            noteAction = .markNoise
        case .escalate:
            noteAction = .escalate
        case .retryInvestigation:
            noteAction = .retryInvestigation
        }
    }
}

/// The item page's action area: the actions whose words carry what an icon cannot (a
/// question's answers, a script) as text buttons, then the icon buttons, wrapping to the next
/// line rather than clipping.
struct ItemActionButtons: View {
    let item: Item

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        ItemActions(item: item) { run in
            let buttons = ItemButton.buttons(for: item)
            let text = buttons.filter(\.isText)
            VStack(alignment: .leading, spacing: 8) {
                if !text.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(text) { button in
                            Button {
                                run(button)
                            } label: {
                                if case .run = button {
                                    Label(button.title, systemImage: button.systemImage)
                                } else {
                                    Text(button.title)
                                }
                            }
                            .disabled(isStarting(button))
                            .accessibilityIdentifier(button.accessibilityIdentifier(itemID: item.id))
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .tint(palette.ink)
                }
                FlowLayout(spacing: 10) {
                    ForEach(buttons.filter { !$0.isText }) { button in
                        CowtailIconButton(
                            title: button.title,
                            systemImage: button.systemImage,
                            role: button.role,
                            style: button.isProminent ? .prominent : .bordered,
                            isBusy: button.isAlertCall && store.isPerformingAlertAction(on: item)
                        ) {
                            run(button)
                        }
                        .accessibilityIdentifier(button.accessibilityIdentifier(itemID: item.id))
                    }
                }
            }
        }
    }

    private func isStarting(_ button: ItemButton) -> Bool {
        if case .run(let script) = button {
            return store.scriptsStarting.contains(script.id)
        }
        return false
    }
}

extension View {
    /// The script's prompt before it runs: Run, or Cancel.
    func runbookConfirmation(
        _ script: Binding<RunbookScript?>,
        run: @escaping (RunbookScript) -> Void
    ) -> some View {
        alert(
            script.wrappedValue?.name ?? "",
            isPresented: Binding(get: { script.wrappedValue != nil }, set: {
                if !$0 {
                    script.wrappedValue = nil
                }
            }),
            presenting: script.wrappedValue
        ) { shown in
            Button("Run", role: .destructive) { run(shown) }
            Button("Cancel", role: .cancel) {}
        } message: { shown in
            Text(shown.confirmText ?? "")
        }
    }
}
