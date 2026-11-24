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

    var isAnswer: Bool {
        switch self {
        case .approve, .deny, .choose, .reply: true
        case .snooze, .ack, .open: false
        }
    }
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
    /// The registered source's display name.
    let sourceName: String
    /// The registered source's uploaded icon, absent until it has one.
    let sourceIconURL: URL?
    let kind: ItemKind
    let urgency: ItemUrgency
    var state: ItemState
    var needsOwner: Bool
    let title: String
    let body: String
    let links: [ItemLink]
    let context: [String: String]
    /// The context keys in the server's order.
    let contextOrder: [String]
    let occurrenceCount: Int
    let actions: [ItemAction]
    /// What the server still lets the owner do: no answer once answered, only links once closed.
    var availableActions: [ItemAction]
    let alertID: String?
    /// The owner's calls on the linked alert that the server accepts now.
    let alertActions: [AlertHumanAction]
    /// The linked alert's investigation results.
    let rootCause: String?
    let actionTaken: String?
    /// The note the owner gave when they marked the alert as noise or escalated it.
    let ownerNote: String?
    /// Answering approve or deny needs Face ID: the owner's current setting, from the server.
    let approvalNeedsAuth: Bool
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
        sourceName: String? = nil,
        sourceIconURL: URL? = nil,
        kind: ItemKind,
        urgency: ItemUrgency,
        state: ItemState = .open,
        needsOwner: Bool = false,
        title: String,
        body: String = "",
        links: [ItemLink] = [],
        context: [String: String] = [:],
        contextOrder: [String]? = nil,
        occurrenceCount: Int = 1,
        actions: [ItemAction] = [],
        availableActions: [ItemAction]? = nil,
        alertID: String? = nil,
        alertActions: [AlertHumanAction] = [],
        rootCause: String? = nil,
        actionTaken: String? = nil,
        ownerNote: String? = nil,
        approvalNeedsAuth: Bool = false,
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
        self.sourceName = sourceName ?? source
        self.sourceIconURL = sourceIconURL
        self.kind = kind
        self.urgency = urgency
        self.state = state
        self.needsOwner = needsOwner
        self.title = title
        self.body = body
        self.links = links
        self.context = context
        self.contextOrder = contextOrder ?? context.keys.sorted()
        self.occurrenceCount = occurrenceCount
        self.actions = actions
        self.availableActions = availableActions ?? actions
        self.alertID = alertID
        self.alertActions = alertActions
        self.rootCause = rootCause
        self.actionTaken = actionTaken
        self.ownerNote = ownerNote
        self.approvalNeedsAuth = approvalNeedsAuth
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

/// One step Hermes recorded in an investigation: what it checked, the command and its output.
struct EvidenceStep: Hashable, Sendable {
    let step: String
    var command: String?
    var output: String?
}

struct ItemEvent: Identifiable, Hashable, Sendable {
    let id: String
    let at: Date
    let type: ItemEventType
    let actor: String
    /// The payload's scalar values, as text.
    let payload: [String: String]
    /// A finished investigation's steps, in order.
    var evidence: [EvidenceStep] = []
}

/// An earlier firing of the item's alert, as the server matched it.
struct PriorOccurrence: Identifiable, Hashable, Sendable {
    struct Fix: Hashable, Sendable {
        let description: String
        let rootCause: String
        var commit: String?
    }

    let alertID: String
    let firedAt: Date
    let outcome: ItemOutcome
    let rootCause: String?
    let summary: String
    /// What the row shows: the server's pick of the root cause, or the summary without one.
    let cause: String
    /// The newest fix's commit, as the server picked it.
    var fixCommit: String?
    var fixes: [Fix] = []

    var id: String { alertID }
}

struct ItemDetail: Hashable, Sendable {
    var item: Item
    let events: [ItemEvent]
    /// The fixes recorded against the linked alert, newest first.
    var fixes: [AlertFix] = []
    /// Up to 3 earlier firings of the linked alert, newest first.
    var priorOccurrences: [PriorOccurrence] = []
}

struct ItemInbox: Equatable, Sendable {
    struct Counts: Equatable, Sendable {
        var needsYou: Int
        var withHermes: Int
        var handled: Int
    }

    /// The server's totals, moved only by the owner's own optimistic writes.
    var counts: Counts
    var needsYou: [Item]
    var withHermes: [Item]
    var handled: [Item]

    static let empty = ItemInbox(needsYou: [], withHermes: [], handled: [])

    func item(withID id: String) -> Item? {
        (needsYou + withHermes + handled).first { $0.id == id }
    }
}

extension ItemInbox {
    /// An inbox whose totals are its lists, as a stand-in server builds it.
    init(needsYou: [Item], withHermes: [Item], handled: [Item]) {
        self.init(
            counts: Counts(needsYou: needsYou.count, withHermes: withHermes.count, handled: handled.count),
            needsYou: needsYou,
            withHermes: withHermes,
            handled: handled
        )
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

    var isAnswer: Bool {
        switch self {
        case .ack, .snooze: false
        case .approve, .deny, .choose, .reply: true
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
    /// The range the server counted.
    var from: Date? = nil
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
    /// The sources to stack and list, in the server's order.
    var volumeSources: [String] = []
    let firingCount: Int
    let firingByNamespace: [NamespaceCount]
}

struct UserDevice: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let lastSeenAt: Date
}
