import SwiftUI

/// One item in Inbox or History. The style picks the second line and what ends the row.
struct ItemRow: View {
    enum Style {
        case needsYou
        case withHermes
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
                    summary
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("row.item.\(item.id)")

                trailing
            }

            if style == .needsYou {
                ItemChoiceButtons(item: item)
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
        case .handled, .history:
            if let outcome = item.outcome {
                CowtailStatusBadge(title: outcome.label, tint: outcome.tint(palette))
            } else {
                CowtailStatusBadge(title: item.state.rawValue, tint: item.state.tint(palette))
            }
        }
    }
}

/// The icon buttons for what an item offers. The item header adds the owner's alert calls.
struct ItemActionButtons: View {
    let item: Item
    var includesAlertActions = false

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.openURL) private var openURL
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
            Task { await store.perform(.snooze(until: .now.addingTimeInterval(ItemNotifications.snoozeInterval)), on: item) }
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

/// A question's answers, as text buttons under its row.
struct ItemChoiceButtons: View {
    let item: Item

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        if let options {
            HStack(spacing: 6) {
                ForEach(options, id: \.self) { option in
                    Button(option) {
                        Task { await store.perform(.choose(option), on: item) }
                    }
                    .font(.cowtailSans(13, weight: .medium, relativeTo: .footnote))
                    .foregroundStyle(palette.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .overlay(Capsule().stroke(palette.border, lineWidth: 1))
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("button.item.choose.\(item.id).\(option)")
                }
            }
        }
    }

    private var options: [String]? {
        for case .choose(let options) in item.availableActions {
            return options
        }
        return nil
    }
}
