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
        case .unsnooze: "unsnoozed"
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

extension SnoozeOption.Preset {
    var title: String {
        switch self {
        case .oneHour: "1 hour"
        case .fourHours: "4 hours"
        case .tomorrow: "Tomorrow"
        case .nextMonday: "Next Monday"
        }
    }

    var identifier: String {
        switch self {
        case .oneHour: "1h"
        case .fourHours: "4h"
        case .tomorrow: "tomorrow"
        case .nextMonday: "next-monday"
        }
    }
}

/// A button an item row or the item header shows: one per action the item offers, and the
/// owner's alert dispositions.
enum ItemButton: Hashable, Identifiable {
    case approve, deny, reply, ack, snooze, unsnooze
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
            case .choose, .run: nil
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
        case .unsnooze: "Unsnooze"
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
        case .unsnooze: "arrow.clockwise"
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
        case .unsnooze: "unsnooze"
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
        case .runStarted:
            return "\(payload["scriptName"] ?? "Script") started"
        case .runFinished:
            let outcome = payload["exitCode"].map { "exit \($0)" } ?? "outcome unknown"
            let result = "\(payload["scriptName"] ?? "Script") · \(outcome)"
            return [result, payload["excerpt"]].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: "\n")
        case .itemAdded, .itemRemoved:
            return payload["reason"] ?? ""
        case .postmortemWritten:
            return "Hermes wrote the postmortem"
        case .stateChanged, .resolved:
            let change = [payload["from"], payload["to"]].compactMap { $0 }.joined(separator: " → ")
            let reason = payload["reason"]
            return [change, reason].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
        }
    }

    func tint(_ palette: ThemePalette) -> Color {
        switch type {
        case .hermesUpdate, .dispatched, .runFinished, .postmortemWritten: palette.info
        case .actionTaken, .runStarted: palette.warning
        case .resolved: palette.success
        case .created, .repeated, .itemAdded: palette.accent
        case .notified, .stateChanged, .itemRemoved: palette.mutedInk
        }
    }

    /// The event's label: its type, and in an incident's timeline the member it concerns.
    var heading: String {
        [type.rawValue, itemTitle].compactMap { $0 }.joined(separator: " · ")
    }
}

extension IncidentState {
    func tint(_ palette: ThemePalette) -> Color {
        switch self {
        case .open: palette.accent
        case .resolved: palette.success
        }
    }
}

extension IncidentSummary {
    var memberCountText: String {
        "\(memberCount) \(memberCount == 1 ? "item" : "items")"
    }

    /// The incident row's line: "Incident · 11 items · now · 47m", the urgency in its tint.
    func line(_ palette: ThemePalette) -> Text {
        var text = Text("Incident · \(memberCountText)")
        if let worstUrgency {
            text = Text("\(text) · \(Text(worstUrgency.rawValue).foregroundStyle(worstUrgency.tint(palette)))")
        }
        return Text("\(text) · \(ItemFormat.duration(duration))")
    }

    /// Sun 22 Nov 22:31–23:18, or 22:31–now while it lasts.
    var span: String {
        let day = startedAt.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        let end = resolvedAt.map(ItemFormat.time) ?? "now"
        return "\(day) \(ItemFormat.time(startedAt))–\(end)"
    }
}

extension Incident.PostmortemState {
    /// What the postmortem section says while there is no postmortem to show.
    var waitingText: String {
        switch self {
        case .none: "Hermes writes the postmortem once the incident resolves."
        case .requested: "Hermes is writing the postmortem."
        case .written: ""
        case .failed: "No postmortem arrived in time. Request it again."
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
    /// The fix commit, short, or a dash without one.
    var fixCommitText: String {
        fixCommit.map { String($0.prefix(7)) } ?? "–"
    }
}

extension RunbookRun {
    func tint(_ palette: ThemePalette) -> Color {
        switch status {
        case .queued: palette.mutedInk
        case .running: palette.warning
        case .succeeded: palette.success
        case .failed: palette.accent
        case .unknown: palette.warning
        }
    }

    /// How long the run has taken, up to `now` while it runs.
    func elapsed(now: Date = .now) -> String {
        ItemFormat.elapsed((finishedAt ?? now).timeIntervalSince(startedAt ?? createdAt))
    }

    /// What a recent run's row ends in: its exit code, or its status while it has none.
    var result: String {
        exitCode.map { "exit \($0)" } ?? status.rawValue
    }
}

enum ItemFormat {
    /// 0:07, 12:40, 1:02:05.
    static func elapsed(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval))
        let clock = String(format: "%d:%02d", seconds / 60 % 60, seconds % 60)
        return seconds >= 3_600 ? String(format: "%d:%02d:%02d", seconds / 3_600, seconds / 60 % 60, seconds % 60) : clock
    }

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

    /// When a snoozed item returns, in the device's zone: Today 13:41, Fri 09:00 within the
    /// coming six days, otherwise 30 Nov 09:00.
    static func returnTime(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: date)
        ).day ?? 0
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        switch days {
        case 0: formatter.dateFormat = "'Today' HH:mm"
        case 1...6: formatter.dateFormat = "EEE HH:mm"
        default: formatter.dateFormat = "d MMM HH:mm"
        }
        return formatter.string(from: date)
    }

    /// 12 Nov.
    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.day(.twoDigits).month(.abbreviated))
    }

    /// 537M, 0.9, 12.5K.
    static func compact(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.significantDigits(1...3)))
    }

    static func percent(_ share: Double) -> String {
        share.formatted(.percent.precision(.fractionLength(0...1)))
    }
}

extension MaintenanceWindow {
    /// What the window silences: all alerts or its label matchers, then the other sources it
    /// holds back.
    var scope: String {
        let alerts = allAlerts ? ["All alerts"] : []
        let matched = matchers.map { "\($0.label)=\($0.value)" }
        let held = heldSources.map { $0 == "*" ? "every source" : $0 }
        return (alerts + matched + held).joined(separator: ", ")
    }

    /// The time left, in whole minutes rounded up.
    func remaining(now: Date = .now) -> String {
        ItemFormat.duration((endsAt.timeIntervalSince(now) / 60).rounded(.up) * 60)
    }
}

extension ItemGraph {
    /// > 537M
    var thresholdText: String? {
        threshold.map { "\($0.op) \(ItemFormat.compact($0.value))" }
    }

    /// firing 09:12–09:40, or firing since 09:12 while it still fires.
    var firingText: String? {
        firing.map { firing in
            firing.end.map { "firing \(ItemFormat.time(firing.start))–\(ItemFormat.time($0))" }
                ?? "firing since \(ItemFormat.time(firing.start))"
        }
    }
}
