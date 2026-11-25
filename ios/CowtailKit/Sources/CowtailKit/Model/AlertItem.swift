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

enum AlertHumanAction: String, Codable {
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
}

struct AlertFix: Identifiable, Hashable, Sendable {
    let id: String
    let description: String
    let rootCause: String
    let scope: FixScope
    let timestamp: Date
}
