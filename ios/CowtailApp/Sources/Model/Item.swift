import Foundation

// The app's view of the server's items. Every field is the server's: the app maps the wire
// format to Swift types and decides nothing about an item's state.

enum ItemKind: String, CaseIterable, Identifiable, Sendable {
    case alert, failure, approval, question, fyi, done

    var id: String { rawValue }
}

enum ItemUrgency: String, CaseIterable, Identifiable, Sendable {
    case now, today, whenever

    var id: String { rawValue }
}

enum ItemState: String, Sendable {
    case open, acked, snoozed, resolved, expired
}

enum ItemOutcome: String, CaseIterable, Identifiable, Sendable {
    case fixed
    case selfResolved = "self-resolved"
    case noise
    case escalated
    case other

    var id: String { rawValue }
}

enum ItemInvestigationStep: String, Sendable {
    case queued, investigating, failed
}

enum ItemAction: Hashable, Sendable {
    case approve
    case deny
    case choose([String])
    case reply
    case snooze
    case ack
    case open(URL)
}

struct ItemLink: Hashable, Sendable {
    let label: String
    let url: URL
}

struct ItemUpdate: Hashable, Sendable {
    let text: String
    let at: Date
}

struct Item: Identifiable, Hashable, Sendable {
    let id: String
    let source: String
    let kind: ItemKind
    let urgency: ItemUrgency
    var state: ItemState
    var needsOwner: Bool
    let title: String
    let body: String
    let links: [ItemLink]
    let context: [String: String]
    let occurrenceCount: Int
    let actions: [ItemAction]
    let alertID: String?
    let expiresAt: Date?
    let createdAt: Date
    let updatedAt: Date
    let resolvedAt: Date?
    let subtitle: String?
    let latestUpdate: ItemUpdate?
    let investigationStep: ItemInvestigationStep?
    let outcome: ItemOutcome?
    let resolvedAfter: TimeInterval?
    /// List results only: the server's day for the item, `yyyy-MM-dd`.
    var createdDate: String?

    init(
        id: String,
        source: String,
        kind: ItemKind,
        urgency: ItemUrgency,
        state: ItemState = .open,
        needsOwner: Bool = false,
        title: String,
        body: String = "",
        links: [ItemLink] = [],
        context: [String: String] = [:],
        occurrenceCount: Int = 1,
        actions: [ItemAction] = [],
        alertID: String? = nil,
        expiresAt: Date? = nil,
        createdAt: Date,
        updatedAt: Date? = nil,
        resolvedAt: Date? = nil,
        subtitle: String? = nil,
        latestUpdate: ItemUpdate? = nil,
        investigationStep: ItemInvestigationStep? = nil,
        outcome: ItemOutcome? = nil,
        resolvedAfter: TimeInterval? = nil,
        createdDate: String? = nil
    ) {
        self.id = id
        self.source = source
        self.kind = kind
        self.urgency = urgency
        self.state = state
        self.needsOwner = needsOwner
        self.title = title
        self.body = body
        self.links = links
        self.context = context
        self.occurrenceCount = occurrenceCount
        self.actions = actions
        self.alertID = alertID
        self.expiresAt = expiresAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.resolvedAt = resolvedAt
        self.subtitle = subtitle
        self.latestUpdate = latestUpdate
        self.investigationStep = investigationStep
        self.outcome = outcome
        self.resolvedAfter = resolvedAfter
        self.createdDate = createdDate
    }
}

enum ItemEventType: String, CaseIterable, Sendable {
    case created
    case repeated
    case dispatched
    case hermesUpdate = "hermes_update"
    case notified
    case actionTaken = "action_taken"
    case stateChanged = "state_changed"
    case resolved
}

struct ItemEvent: Identifiable, Hashable, Sendable {
    let id: String
    let at: Date
    let type: ItemEventType
    let actor: String
    /// The payload's scalar values, as text.
    let payload: [String: String]
}

struct ItemDetail: Hashable, Sendable {
    var item: Item
    let events: [ItemEvent]
}

struct ItemInbox: Equatable, Sendable {
    var needsYou: [Item]
    var withHermes: [Item]
    var handled: [Item]

    static let empty = ItemInbox(needsYou: [], withHermes: [], handled: [])

    func item(withID id: String) -> Item? {
        (needsYou + withHermes + handled).first { $0.id == id }
    }
}

/// What the owner sends; `ItemAction` is what an item offers.
enum ItemActionRequest: Hashable, Sendable {
    case ack
    case snooze(until: Date)
    case approve
    case deny
    case choose(String)
    case reply(String)

    var isApproval: Bool {
        switch self {
        case .approve, .deny: true
        default: false
        }
    }
}

struct ItemListQuery: Hashable, Sendable {
    var source: String?
    var kind: ItemKind?
    var outcome: ItemOutcome?
    var search: String?
    var from: Date?
    var to: Date?
    var alertID: String?
    var cursor: String?
    var limit = 100
}

struct ItemPage: Equatable, Sendable {
    struct Day: Equatable, Sendable {
        let date: String
        let count: Int
    }

    let items: [Item]
    let nextCursor: String?
    /// The page's days, in page order, each counted across the whole filtered list.
    var days: [Day] = []
}

struct ItemStats: Equatable, Sendable {
    struct KindResolveTime: Equatable, Sendable {
        let kind: ItemKind
        let count: Int
        let median: TimeInterval
        let p90: TimeInterval
    }

    struct RepeatOffender: Equatable, Sendable {
        let dedupeKey: String
        let title: String
        let occurrenceCount: Int
        let noiseShare: Double
    }

    struct DailyVolume: Equatable, Sendable {
        let date: String
        let total: Int
        let bySource: [String: Int]
    }

    struct NamespaceCount: Equatable, Sendable {
        let namespace: String
        let count: Int
    }

    let createdCount: Int
    let resolvedCount: Int
    let outcomeMix: [ItemOutcome: Int]
    let noiseRate: Double
    let timeToResolve: [KindResolveTime]
    let repeatOffenders: [RepeatOffender]
    let dailyVolume: [DailyVolume]
    let firingCount: Int
    let firingByNamespace: [NamespaceCount]
}

struct UserDevice: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let lastSeenAt: Date
}
