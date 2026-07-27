import Foundation
import SwiftUI

enum AlertSeverity: String, CaseIterable, Decodable, Identifiable {
    case critical
    case warning
    case info
    case unknown

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = AlertSeverity(rawValue: (try? container.decode(String.self)) ?? "") ?? .unknown
    }

    var label: String {
        rawValue.capitalized
    }

    var tint: Color {
        switch self {
        case .critical:
            return .red
        case .warning:
            return .orange
        case .info:
            return .blue
        case .unknown:
            return .gray
        }
    }

    var symbolName: String {
        switch self {
        case .critical:
            return "exclamationmark.octagon.fill"
        case .warning:
            return "exclamationmark.triangle.fill"
        case .info:
            return "bell.fill"
        case .unknown:
            return "questionmark.circle.fill"
        }
    }

    var prefersStrongBadge: Bool {
        false
    }
}

enum AlertOutcome: String, Decodable, Identifiable {
    case pending
    case recorded
    case fixed
    case selfResolved = "self-resolved"
    case noise
    case escalated
    case unknown

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = AlertOutcome(rawValue: (try? container.decode(String.self)) ?? "") ?? .unknown
    }

    var label: String {
        switch self {
        case .pending:
            return "Pending"
        case .recorded:
            return "Recorded"
        case .fixed:
            return "Fixed"
        case .selfResolved:
            return "Self-resolved"
        case .noise:
            return "Noise"
        case .escalated:
            return "Escalated"
        case .unknown:
            return "Unknown"
        }
    }

    var tint: Color {
        switch self {
        case .pending, .recorded:
            return .gray
        case .fixed:
            return .green
        case .selfResolved:
            return .mint
        case .noise:
            return .gray
        case .escalated:
            return .red
        case .unknown:
            return .gray
        }
    }

    var symbolName: String {
        switch self {
        case .pending:
            return "clock.fill"
        case .recorded:
            return "tray.full.fill"
        case .fixed:
            return "checkmark.circle.fill"
        case .selfResolved:
            return "arrow.clockwise.circle.fill"
        case .noise:
            return "speaker.slash.fill"
        case .escalated:
            return "arrow.up.circle.fill"
        case .unknown:
            return "questionmark.circle.fill"
        }
    }

    var prefersStrongBadge: Bool {
        switch self {
        case .fixed, .escalated:
            return true
        case .pending, .recorded, .selfResolved, .noise, .unknown:
            return false
        }
    }
}

enum AlertLifecycleStatus: String, Decodable, Identifiable {
    case firing
    case resolved
    case unknown

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = AlertLifecycleStatus(rawValue: (try? container.decode(String.self)) ?? "") ?? .unknown
    }

    var label: String {
        rawValue.capitalized
    }
}

enum AlertInvestigationStatus: String, Decodable, Identifiable {
    case queued
    case claimed
    case done
    case failed
    case deadletter

    var id: String { rawValue }
}

enum AlertInvestigationPriority: String, Decodable {
    case low
    case normal
    case high
}

enum AlertOwnerDisposition: String, Decodable {
    case noise
    case escalated
}

enum AlertHumanAction: String, Encodable {
    static let noteCharacterLimit = 500

    case retryInvestigation = "retry-investigation"
    case markNoise = "mark-noise"
    case escalate
}

struct AlertInvestigation: Equatable {
    let id: String
    let status: AlertInvestigationStatus
    let priority: AlertInvestigationPriority
    let attempts: Int
    let maxAttempts: Int
    let nextAttemptAt: Date
    let claimedAt: Date?
    let leaseUntil: Date?
    let lastError: String
    let lastErrorPhase: String
    let completedAt: Date?
    let deadletteredAt: Date?
    let updatedAt: Date

    var canRetry: Bool {
        status == .done || status == .failed || status == .deadletter
    }
}

enum AlertWorkflowState: Equatable {
    case investigationFailed
    case needsReview
    case investigating
    case queued
    case monitoring
    case active
    case recovered
    case fixed
    case classifiedNoise
    case recorded

    var label: String {
        switch self {
        case .investigationFailed: "Investigation failed"
        case .needsReview: "Needs your review"
        case .investigating: "Investigating"
        case .queued: "Queued"
        case .monitoring: "Fix applied, still firing"
        case .active: "Active"
        case .recovered: "Recovered"
        case .fixed: "Fixed"
        case .classifiedNoise: "Classified as noise"
        case .recorded: "Recorded"
        }
    }

    var symbolName: String {
        switch self {
        case .investigationFailed: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90"
        case .needsReview: "person.crop.circle.badge.exclamationmark"
        case .investigating: "waveform.path.ecg"
        case .queued: "clock.arrow.circlepath"
        case .monitoring: "eye.fill"
        case .active: "bolt.fill"
        case .recovered: "arrow.uturn.backward.circle.fill"
        case .fixed: "checkmark.circle.fill"
        case .classifiedNoise: "speaker.slash.fill"
        case .recorded: "tray.full.fill"
        }
    }

    var tint: Color {
        switch self {
        case .investigationFailed, .needsReview: .red
        case .investigating, .queued: .blue
        case .monitoring, .active: .orange
        case .recovered: .mint
        case .fixed: .green
        case .classifiedNoise, .recorded: .secondary
        }
    }

    var needsHumanAttention: Bool {
        self == .investigationFailed || self == .needsReview
    }

    var isInProgress: Bool {
        switch self {
        case .investigating, .queued, .monitoring, .active:
            true
        case .investigationFailed, .needsReview, .recovered, .fixed, .classifiedNoise, .recorded:
            false
        }
    }
}

enum FixScope: String, Decodable, Identifiable {
    case reactive
    case weekly
    case monthly
    case unknown

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = FixScope(rawValue: (try? container.decode(String.self)) ?? "") ?? .unknown
    }

    var label: String {
        rawValue.capitalized
    }

    var tint: Color {
        switch self {
        case .reactive:
            return .green
        case .weekly:
            return .blue
        case .monthly:
            return .purple
        case .unknown:
            return .gray
        }
    }
}

struct AlertItem: Identifiable, Equatable {
    let id: String
    let timestamp: Date
    let alertName: String
    let severity: AlertSeverity
    let namespace: String
    let node: String
    let outcome: AlertOutcome
    let summary: String
    let rootCause: String
    let actionTaken: String
    let status: AlertLifecycleStatus
    let resolvedAt: Date?
    let messaged: Bool
    let investigation: AlertInvestigation?
    let ownerDisposition: AlertOwnerDisposition?
    let ownerNote: String
    let ownerUpdatedAt: Date?

    init(
        id: String,
        timestamp: Date,
        alertName: String,
        severity: AlertSeverity,
        namespace: String,
        node: String,
        outcome: AlertOutcome,
        summary: String,
        rootCause: String,
        actionTaken: String,
        status: AlertLifecycleStatus,
        resolvedAt: Date?,
        messaged: Bool,
        investigation: AlertInvestigation? = nil,
        ownerDisposition: AlertOwnerDisposition? = nil,
        ownerNote: String = "",
        ownerUpdatedAt: Date? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.alertName = alertName
        self.severity = severity
        self.namespace = namespace
        self.node = node
        self.outcome = outcome
        self.summary = summary
        self.rootCause = rootCause
        self.actionTaken = actionTaken
        self.status = status
        self.resolvedAt = resolvedAt
        self.messaged = messaged
        self.investigation = investigation
        self.ownerDisposition = ownerDisposition
        self.ownerNote = ownerNote
        self.ownerUpdatedAt = ownerUpdatedAt
    }

    var sourceLine: String {
        [namespace, node]
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }

    var webURL: URL? {
        AppConfig.alertDetailURL(for: id)
    }

    var workflowState: AlertWorkflowState {
        if ownerDisposition == .noise || outcome == .noise {
            return .classifiedNoise
        }
        if ownerDisposition == .escalated {
            return .needsReview
        }
        if status == .resolved {
            if outcome == .escalated {
                return .needsReview
            }
            return outcome == .fixed ? .fixed : .recovered
        }
        if outcome == .selfResolved {
            return .recovered
        }
        if investigation?.status == .deadletter || investigation?.status == .failed {
            return .investigationFailed
        }
        if outcome == .escalated {
            return .needsReview
        }
        if investigation?.status == .claimed {
            return .investigating
        }
        if investigation?.status == .queued {
            return .queued
        }
        if status == .firing, outcome == .fixed {
            return .monitoring
        }
        if status == .firing, outcome != .noise {
            return .active
        }
        if outcome == .fixed {
            return .fixed
        }
        return .recorded
    }

    func applying(action: AlertHumanAction, note: String?, now: Date = .now) -> AlertItem {
        let updatedInvestigation = investigation.map { current in
            AlertInvestigation(
                id: current.id,
                status: action == .retryInvestigation ? .queued : .done,
                priority: current.priority,
                attempts: action == .retryInvestigation ? 0 : current.attempts,
                maxAttempts: current.maxAttempts,
                nextAttemptAt: action == .retryInvestigation ? now : current.nextAttemptAt,
                claimedAt: action == .retryInvestigation ? nil : current.claimedAt,
                leaseUntil: action == .retryInvestigation ? nil : current.leaseUntil,
                lastError: action == .retryInvestigation ? "" : current.lastError,
                lastErrorPhase: action == .retryInvestigation ? "" : current.lastErrorPhase,
                completedAt: action == .retryInvestigation ? nil : now,
                deadletteredAt: action == .retryInvestigation ? nil : current.deadletteredAt,
                updatedAt: now
            )
        }
        let disposition: AlertOwnerDisposition? = switch action {
        case .retryInvestigation: nil
        case .markNoise: .noise
        case .escalate: .escalated
        }
        let updatedOutcome: AlertOutcome = switch action {
        case .retryInvestigation: .pending
        case .markNoise: .noise
        case .escalate: .escalated
        }
        let actionLabel = switch action {
        case .retryInvestigation: "Investigation retried by owner"
        case .markNoise: "Marked as noise"
        case .escalate: "Escalated for owner review"
        }

        return AlertItem(
            id: id,
            timestamp: timestamp,
            alertName: alertName,
            severity: severity,
            namespace: namespace,
            node: node,
            outcome: updatedOutcome,
            summary: summary,
            rootCause: rootCause,
            actionTaken: note.map { "\(actionLabel): \($0)" } ?? "\(actionLabel).",
            status: status,
            resolvedAt: resolvedAt,
            messaged: action == .retryInvestigation ? messaged : true,
            investigation: updatedInvestigation,
            ownerDisposition: disposition,
            ownerNote: note ?? "",
            ownerUpdatedAt: disposition == nil ? nil : now
        )
    }
}

struct AlertFix: Identifiable, Equatable {
    let id: String
    let description: String
    let rootCause: String
    let scope: FixScope
    let timestamp: Date
}
