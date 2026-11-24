import Foundation

/// What Hermes is doing, as the server reports it. The server decides the level, which jobs
/// are failing and their order, and which item each incident links to.
struct HermesStatus: Equatable, Sendable {
    enum Level: String, Sendable {
        case green
        case amber
        case red
    }

    struct CronJob: Identifiable, Equatable, Sendable {
        let id: String
        let name: String
        let schedule: String
        var lastRunAt: Date?
        var lastStatus: String?
        var nextRunAt: Date?
        let failing: Bool
    }

    struct Incident: Identifiable, Equatable, Sendable {
        let id: String
        let jobName: String
        let state: String
        var failureType: String?
        var firstSeenAt: Date?
        var error: String?
        var itemID: String?
        var itemTitle: String?
    }

    /// A budget or rate-limit entry, as Hermes names and reports it.
    struct Limit: Hashable, Sendable {
        let key: String
        let value: String
    }

    struct Kanban: Equatable, Sendable {
        let blocked: Int
        let running: Int
    }

    struct Heartbeat: Equatable, Sendable {
        let receivedAt: Date
        var level: Level?
        var platforms: [String] = []
        var model: String?
        var provider: String?
        var cronJobs: [CronJob] = []
        var cronJobCount = 0
        var failingCronCount = 0
        var incidents: [Incident] = []
        var incidentCount = 0
        var kanban: Kanban?
        /// Hermes has blocked kanban work, shown as a warning.
        var kanbanBlocked = false
        var budget: [Limit] = []
        var rateLimits: [Limit] = []
    }

    struct Answer: Identifiable, Equatable, Sendable {
        var id: String { itemID }
        let itemID: String
        let title: String
        let answer: ItemActionRequest
        let answeredAt: Date
    }

    /// Nil until Hermes sends its first heartbeat.
    var heartbeat: Heartbeat?
    var recentAnswers: [Answer] = []
}
