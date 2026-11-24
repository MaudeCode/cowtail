import Foundation

struct HealthSummary: Equatable, Sendable {
    enum PipelineState: String, Sendable {
        case ok
        case silent
        case notConfigured = "not_configured"
    }

    let nodes: [HealthNode]
    let cephStatus: String
    let cephMessage: String
    let storageTotal: Double
    let storageUsed: Double
    let storageUnit: String
    var pipelineState: PipelineState? = nil
    var lastWatchdogAt: Date? = nil

    var readyNodeCount: Int {
        nodes.filter(\.isReady).count
    }
}

struct HealthNode: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let isReady: Bool
    let cpu: Int
    let memory: Int
}
