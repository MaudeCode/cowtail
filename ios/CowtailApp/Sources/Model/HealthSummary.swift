import Foundation

struct HealthSummary: Equatable {
    let nodes: [HealthNode]
    let cephStatus: String
    let cephMessage: String
    let storageTotal: Double
    let storageUsed: Double
    let storageUnit: String

    var readyNodeCount: Int {
        nodes.filter(\.isReady).count
    }
}

struct HealthNode: Identifiable, Equatable {
    let id: String
    let name: String
    let isReady: Bool
    let cpu: Int
    let memory: Int
}
