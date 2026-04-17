import Foundation

enum CowtailPreviewFixtures {
    static let alert = AlertItem(
        id: "preview-alert",
        timestamp: .now,
        alertName: "CephHealthWarning",
        severity: .critical,
        namespace: "rook-ceph",
        node: "node-a",
        outcome: .escalated,
        summary: "Deep-scrub backlog still needs attention.",
        rootCause: "Scrub schedule drifted during maintenance.",
        actionTaken: "Queued manual scrub and raised an incident.",
        status: .firing,
        resolvedAt: nil,
        messaged: true
    )

    static let secondaryAlert = AlertItem(
        id: "preview-alert-2",
        timestamp: .now.addingTimeInterval(-18 * 60),
        alertName: "IngressCertificateExpiring",
        severity: .warning,
        namespace: "ingress-nginx",
        node: "",
        outcome: .fixed,
        summary: "The default ingress certificate rotated successfully.",
        rootCause: "The old certificate was near expiry.",
        actionTaken: "Applied a refreshed certificate bundle.",
        status: .resolved,
        resolvedAt: .now,
        messaged: true
    )

    static let health = HealthSummary(
        nodes: [
            HealthNode(id: "n1", name: "node-a", isReady: true, cpu: 63, memory: 71),
            HealthNode(id: "n2", name: "node-b", isReady: true, cpu: 58, memory: 64)
        ],
        cephStatus: "HEALTH_WARN",
        cephMessage: "Deep-scrub backlog needs attention.",
        storageTotal: 100,
        storageUsed: 68,
        storageUnit: "TiB"
    )

    static let fixes: [AlertFix] = [
        AlertFix(
            id: "fix-1",
            description: "Queued manual scrub for overdue placement groups.",
            rootCause: "Scrub backlog accumulated during maintenance.",
            scope: .reactive,
            timestamp: .now.addingTimeInterval(-45 * 60)
        )
    ]
}
