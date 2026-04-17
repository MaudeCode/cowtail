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
        case .fixed:
            return "checkmark.circle.fill"
        case .selfResolved:
            return "arrow.trianglehead.clockwise.circle.fill"
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
        case .selfResolved, .noise, .unknown:
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

    var sourceLine: String {
        [namespace, node]
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }

    var webURL: URL? {
        AppConfig.alertDetailURL(for: id)
    }
}

struct AlertFix: Identifiable, Equatable {
    let id: String
    let description: String
    let rootCause: String
    let scope: FixScope
    let timestamp: Date
}
