import Foundation

// Related items the server grouped into one incident, with one timeline and Hermes's
// postmortem. Every field is the server's.

enum IncidentState: String, Sendable {
    case open, resolved
}

/// An incident as its row and an item's incident chip show it.
struct IncidentSummary: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    var state: IncidentState
    var memberCount: Int
    /// The highest urgency of its members, absent when it has none.
    let worstUrgency: ItemUrgency?
    /// Its first member's creation.
    let startedAt: Date
    let resolvedAt: Date?
    /// From `startedAt` to its resolution, or to when the server answered while it is open.
    let duration: TimeInterval
}

struct Incident: Hashable, Sendable {
    enum PostmortemState: String, Sendable {
        case none, requested, written, failed
    }

    /// What the owner can do with it now, besides adding and removing items.
    enum Action: String, Sendable {
        case resolve
        case requestPostmortem = "request_postmortem"
    }

    var summary: IncidentSummary
    var postmortemState: PostmortemState
    /// Markdown, as Hermes wrote it.
    let postmortem: String?
    let postmortemAt: Date?
    var availableActions: [Action]
}

struct IncidentDetail: Hashable, Sendable {
    var incident: Incident
    /// Newest first.
    var members: [Item]
    /// The members' events and the incident's own, oldest first.
    let events: [ItemEvent]
}

/// The owner's change to an incident.
enum IncidentChange: Hashable, Sendable {
    case add(itemID: String)
    case remove(itemID: String)
    case resolve
    case requestPostmortem
}

extension IncidentDetail {
    /// What the owner's own change shows before the server answers. Adding waits for the
    /// server, which works out the incident's new figures.
    func showing(_ change: IncidentChange) -> IncidentDetail {
        var shown = self
        switch change {
        case .remove(let itemID):
            shown.members.removeAll { $0.id == itemID }
            shown.incident.summary.memberCount = shown.members.count
        case .resolve:
            shown.incident.summary.state = .resolved
            shown.incident.availableActions = []
        case .requestPostmortem:
            shown.incident.postmortemState = .requested
            shown.incident.availableActions = []
        case .add:
            break
        }
        return shown
    }
}
