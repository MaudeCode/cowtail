import SwiftUI

// The one table of item wording, tints and icons. The server decides every value; these only
// name and colour them.

extension ItemUrgency {
    func tint(_ palette: ThemePalette) -> Color {
        switch self {
        case .now: palette.accent
        case .today: palette.warning
        case .whenever: palette.mutedInk
        }
    }
}

extension ItemState {
    func tint(_ palette: ThemePalette) -> Color {
        switch self {
        case .open: palette.ink
        case .acked: palette.info
        case .resolved: palette.success
        case .snoozed, .expired: palette.mutedInk
        }
    }
}

extension Item {
    /// The symbol shown while the source has no uploaded icon, or while it loads.
    var sourceSymbol: String {
        switch source {
        case "alertmanager": "bell.badge"
        case "hermes": "sparkles"
        default: "app.badge"
        }
    }
}

extension ItemOutcome {
    var label: String { rawValue }

    func tint(_ palette: ThemePalette) -> Color {
        switch self {
        case .fixed: palette.success
        case .selfResolved: palette.info
        case .escalated: palette.warning
        case .noise, .other: palette.mutedInk
        }
    }
}

extension ItemInvestigationStep {
    var label: String {
        switch self {
        case .queued: "investigation queued"
        case .investigating: "investigating"
        case .failed: "investigation failed"
        }
    }
}

extension HistoryFilter.Range {
    var label: String {
        switch self {
        case .day: "last 24 hours"
        case .week: "last 7 days"
        case .month: "last 30 days"
        case .quarter: "last 90 days"
        }
    }
}

extension HealthSummary.PipelineState {
    var label: String {
        switch self {
        case .ok: "pipeline ok"
        case .silent: "pipeline silent"
        case .notConfigured: "pipeline not set up"
        }
    }

    func tint(_ palette: ThemePalette) -> Color {
        switch self {
        case .ok: palette.success
        case .silent: palette.accent
        case .notConfigured: palette.mutedInk
        }
    }
}

extension HermesStatus.Level {
    func tint(_ palette: ThemePalette) -> Color {
        switch self {
        case .green: palette.success
        case .amber: palette.warning
        case .red: palette.accent
        }
    }
}

extension ItemActionRequest {
    /// The owner's answer, in a word or the words they chose.
    var answerLabel: String {
        switch self {
        case .approve: "approved"
        case .deny: "denied"
        case .ack: "acknowledged"
        case .snooze: "snoozed"
        case .choose(let option): option
        case .reply(let text): text
        }
    }

    func answerTint(_ palette: ThemePalette) -> Color {
        switch self {
        case .approve: palette.success
        case .deny: palette.accent
        default: palette.ink
        }
    }
}

/// A button an item row or the item header shows: one per action the item offers, and the
/// owner's alert dispositions.
enum ItemButton: Hashable, Identifiable {
    case approve, deny, reply, ack, snooze
    case open(URL)
    case markNoise, escalate, retryInvestigation

    var id: String { identifier }

    /// The buttons for an item's `actions`; `choose` shows its options as text instead.
    static func buttons(for item: Item) -> [ItemButton] {
        item.availableActions.compactMap { action in
            switch action {
            case .approve: .approve
            case .deny: .deny
            case .reply: .reply
            case .ack: .ack
            case .snooze: .snooze
            case .open(let url): .open(url)
            case .choose: nil
            }
        }
    }

    var title: String {
        switch self {
        case .approve: "Approve"
        case .deny: "Deny"
        case .reply: "Reply"
        case .ack: "Acknowledge"
        case .snooze: "Snooze"
        case .open: "Open link"
        case .markNoise: "Mark as noise"
        case .escalate: "Escalate"
        case .retryInvestigation: "Retry investigation"
        }
    }

    var systemImage: String {
        switch self {
        case .approve: "checkmark"
        case .deny: "xmark"
        case .reply: "arrowshape.turn.up.left"
        case .ack: "checkmark.circle"
        case .snooze: "clock"
        case .open: "link"
        case .markNoise: "speaker.slash"
        case .escalate: "arrow.up.circle"
        case .retryInvestigation: "arrow.clockwise"
        }
    }

    func tint(_ palette: ThemePalette) -> Color? {
        switch self {
        case .approve: palette.success
        case .deny: palette.accent
        default: nil
        }
    }

    var identifier: String {
        switch self {
        case .approve: "approve"
        case .deny: "deny"
        case .reply: "reply"
        case .ack: "ack"
        case .snooze: "snooze"
        case .open: "open"
        case .markNoise: "mark-noise"
        case .escalate: "escalate"
        case .retryInvestigation: "retry"
        }
    }
}

extension ItemEvent {
    /// What happened, in the owner's words, from the event's payload.
    var text: String {
        switch type {
        case .created:
            return payload["state"].map { "Created, \($0)" } ?? "Created"
        case .repeated:
            return payload["occurrenceCount"].map { "Happened again, ×\($0)" } ?? "Happened again"
        case .dispatched:
            return "Investigation sent to Hermes"
        case .hermesUpdate:
            return payload["text"] ?? ""
        case .notified:
            // The server records what it decided: pushed, or skipped, batched or held and why.
            switch payload["decision"] {
            case "pushed", nil:
                return "Push sent"
            case let decision?:
                let why = payload["why"]?.replacingOccurrences(of: "_", with: " ")
                return [decision.capitalized, why].compactMap { $0 }.joined(separator: " · ")
            }
        case .actionTaken:
            let action = payload["type"] ?? "action"
            let detail = payload["option"] ?? payload["text"]
            return detail.map { "\(actor) · \(action): \($0)" } ?? "\(actor) · \(action)"
        case .stateChanged, .resolved:
            let change = [payload["from"], payload["to"]].compactMap { $0 }.joined(separator: " → ")
            let reason = payload["reason"]
            return [change, reason].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
        }
    }

    func tint(_ palette: ThemePalette) -> Color {
        switch type {
        case .hermesUpdate, .dispatched: palette.info
        case .actionTaken: palette.warning
        case .resolved: palette.success
        case .created, .repeated: palette.accent
        case .notified, .stateChanged: palette.mutedInk
        }
    }
}

extension ItemEvent {
    /// The collapsed evidence's title: "Evidence · 3 steps".
    var evidenceTitle: String {
        "Evidence · \(evidence.count) \(evidence.count == 1 ? "step" : "steps")"
    }
}

extension EvidenceStep {
    /// The step's numbered line: "1 · Read the logs".
    func line(_ number: Int) -> String {
        "\(number) · \(step)"
    }

    /// The command and its output as one monospace block, or nil when the step has neither.
    var block: String? {
        let parts = [command.map { "$ \($0)" }, output].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }
}

extension PriorOccurrence {
    /// The commit that fixed it, short, or a dash when no fix names one.
    var fixCommit: String {
        fixes.lazy.compactMap(\.commit).first.map { String($0.prefix(7)) } ?? "–"
    }

    /// Why it fired: its root cause, or its summary when none was recorded.
    var cause: String {
        rootCause ?? summary
    }
}

enum ItemFormat {
    static func duration(_ interval: TimeInterval, units: Int = 2) -> String {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.maximumUnitCount = units
        formatter.allowedUnits = interval < 60 ? [.second] : [.day, .hour, .minute, .second]
        return formatter.string(from: max(interval, 0)) ?? "0s"
    }

    static func age(of date: Date, now: Date = .now) -> String {
        duration(now.timeIntervalSince(date), units: 1)
    }

    static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    /// 09:42 today, otherwise Sun 16:10.
    static func when(_ date: Date, now: Date = .now) -> String {
        Calendar.current.isDate(date, inSameDayAs: now)
            ? time(date)
            : date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    /// 12 Nov.
    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.day(.twoDigits).month(.abbreviated))
    }

    static func percent(_ share: Double) -> String {
        share.formatted(.percent.precision(.fractionLength(0...1)))
    }
}
