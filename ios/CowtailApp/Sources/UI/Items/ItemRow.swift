import SwiftUI

/// One item in Inbox or History. The style picks the second line and what ends the row.
struct ItemRow: View {
    enum Style {
        case needsYou
        case withHermes
        case upcoming
        case handled
        case history
    }

    let item: Item
    let style: Style

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                NavigationLink(value: AppRoute.item(item.id)) {
                    HStack(alignment: .top, spacing: 10) {
                        ItemSourceIcon(item: item)
                        summary
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("row.item.\(item.id)")

                trailing
            }

            if style == .needsYou {
                ItemTextButtons(item: item)
            }

            if let error = store.actionErrors[item.id] {
                Text(error)
                    .font(.cowtailSans(12, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
            }
        }
        .cowtailRow()
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
                if item.maintenanceWindowID != nil, style == .handled || style == .history {
                    Image(systemName: "wrench.adjustable")
                        .font(.system(size: 11))
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
        case .handled:
            Text([item.subtitle ?? item.sourceName, item.resolvedAt.map(ItemFormat.time)].compactMap { $0 }.joined(separator: " · "))
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

    @ViewBuilder
    private var trailing: some View {
        switch style {
        case .needsYou:
            ItemActionButtons(item: item)
        case .withHermes:
            EmptyView()
        case .upcoming:
            ItemActionButtons(item: item, isUpcoming: true)
        case .handled, .history:
            if let outcome = item.outcome {
                CowtailStatusBadge(title: outcome.label, tint: outcome.tint(palette))
            } else {
                CowtailStatusBadge(title: item.state.rawValue, tint: item.state.tint(palette))
            }
        }
    }
}

/// The item's source: its uploaded icon in a small rounded square, or the source's symbol.
/// VoiceOver reads it as the source's display name, so a row starts with who sent it.
struct ItemSourceIcon: View {
    let item: Item

    @Environment(\.cowtailPalette) private var palette

    private static let size: CGFloat = 22

    var body: some View {
        AsyncImage(url: item.sourceIconURL) { phase in
            if let image = phase.image {
                labeled(image.resizable().scaledToFill(), identifier: "icon.source.image")
            } else {
                labeled(
                    Image(systemName: item.sourceSymbol)
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
            .accessibilityLabel(item.sourceName)
            .accessibilityAddTraits(.isImage)
            .accessibilityIdentifier(identifier)
    }
}

/// The icon buttons for what an item offers. The item header adds the owner's alert calls.
struct ItemActionButtons: View {
    let item: Item
    var includesAlertActions = false
    /// An Upcoming row offers only Unsnooze.
    var isUpcoming = false

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.openURL) private var openURL
    @State private var isSnoozing = false
    @State private var isReplying = false
    @State private var replyText = ""
    @State private var noteAction: AlertHumanAction?
    @State private var noteText = ""

    var body: some View {
        HStack(spacing: 6) {
            ForEach(buttons) { button in
                CowtailIconButton(
                    title: button.title,
                    systemImage: button.systemImage,
                    tint: button.tint(palette),
                    isBusy: isAlertAction(button) && store.isPerformingAlertAction(on: item)
                ) {
                    run(button)
                }
                .accessibilityIdentifier("button.item.\(button.identifier).\(item.id)")
            }
        }
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
    }

    private static func title(_ action: AlertHumanAction) -> String {
        switch action {
        case .markNoise: ItemButton.markNoise.title
        case .escalate: ItemButton.escalate.title
        case .retryInvestigation: ItemButton.retryInvestigation.title
        }
    }

    private var buttons: [ItemButton] {
        if isUpcoming {
            return [.unsnooze]
        }
        var buttons = ItemButton.buttons(for: item)
        if includesAlertActions {
            buttons += item.alertActions.map { action in
                switch action {
                case .retryInvestigation: .retryInvestigation
                case .markNoise: .markNoise
                case .escalate: .escalate
                }
            }
        }
        return buttons
    }

    private func isAlertAction(_ button: ItemButton) -> Bool {
        switch button {
        case .markNoise, .escalate, .retryInvestigation: true
        default: false
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
        case .open(let url):
            openURL(url)
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

/// The actions whose words carry what an icon cannot, as text buttons under the row: a
/// question's answers, and a script action's play glyph and label.
struct ItemTextButtons: View {
    let item: Item

    @EnvironmentObject private var store: CowtailStore
    @State private var confirming: RunbookScript?

    var body: some View {
        if !options.isEmpty || !scripts.isEmpty {
            HStack(spacing: 6) {
                ForEach(options, id: \.self) { option in
                    Button(option) {
                        Task { await store.perform(.choose(option), on: item) }
                    }
                    .buttonStyle(CowtailTextButtonStyle())
                    .accessibilityIdentifier("button.item.choose.\(item.id).\(option)")
                }
                ForEach(scripts) { script in
                    Button {
                        if script.asksToConfirm {
                            confirming = script
                        } else {
                            Task { await store.startRun(script, itemID: item.id) }
                        }
                    } label: {
                        Label(script.name, systemImage: "play.fill")
                    }
                    .buttonStyle(CowtailTextButtonStyle())
                    .disabled(store.scriptsStarting.contains(script.id))
                    .accessibilityIdentifier("button.item.run.\(item.id).\(script.id)")
                }
            }
            .runbookConfirmation($confirming) { script in
                Task { await store.startRun(script, itemID: item.id) }
            }
        }
    }

    private var options: [String] {
        for case .choose(let options) in item.availableActions {
            return options
        }
        return []
    }

    private var scripts: [RunbookScript] {
        item.availableActions.compactMap { action in
            if case .run(let script) = action {
                script
            } else {
                nil
            }
        }
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
