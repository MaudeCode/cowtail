import Foundation

/// Synthetic items, cluster health and stats for previews and the seeded UI-test server.
enum CowtailPreviewFixtures {
    static let health = HealthSummary(
        nodes: [
            HealthNode(id: "node-1", name: "node-1", isReady: true, cpu: 34, memory: 58),
            HealthNode(id: "node-2", name: "node-2", isReady: true, cpu: 71, memory: 86),
            HealthNode(id: "node-3", name: "node-3", isReady: true, cpu: 22, memory: 49),
        ],
        cephStatus: "HEALTH_OK",
        cephMessage: "6 of 6 OSDs up and in",
        storageTotal: 24,
        storageUsed: 14.6,
        storageUnit: "TiB",
        pipelineState: .ok,
        lastWatchdogAt: .now.addingTimeInterval(-2 * 60)
    )

    private static func minutesAgo(_ minutes: Double) -> Date {
        .now.addingTimeInterval(-minutes * 60)
    }

    private static func daysAgo(_ days: Int, hour: Int) -> Date {
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: -days, to: calendar.startOfDay(for: .now)) ?? .now
        return calendar.date(byAdding: .hour, value: hour, to: day) ?? day
    }

    static let approval = Item(
        id: "approval-ingress",
        source: "hermes",
        kind: .approval,
        urgency: .now,
        needsOwner: true,
        title: "Restart ingress in edge?",
        body: "`kubectl rollout restart deploy/ingress -n edge`",
        actions: [.approve, .deny],
        expiresAt: .now.addingTimeInterval(4 * 60),
        createdAt: minutesAgo(1)
    )

    static let question = Item(
        id: "question-osd",
        source: "hermes",
        kind: .question,
        urgency: .now,
        needsOwner: true,
        title: "OSD 4 is 88% full. Rebalance now or wait for the new disk?",
        actions: [.choose(["Rebalance now", "Wait"]), .reply],
        createdAt: minutesAgo(3)
    )

    static let crashLoop = Item(
        id: "alert-crashloop",
        source: "alertmanager",
        kind: .alert,
        urgency: .now,
        needsOwner: true,
        title: "KubePodCrashLooping",
        body: "Pod **transcoder-7d9f** restarted 6 times in 10 minutes.",
        links: [ItemLink(label: "Grafana panel", url: URL(string: "https://grafana.example.com/d/pods")!)],
        context: ["namespace": "media", "severity": "critical", "container": "worker"],
        occurrenceCount: 6,
        actions: [.ack, .snooze],
        alertID: "alert-1",
        createdAt: minutesAgo(30),
        subtitle: "media / transcoder",
        investigationStep: .failed
    )

    static let withHermes = [
        Item(
            id: "alert-memory",
            source: "alertmanager",
            kind: .alert,
            urgency: .today,
            title: "NodeMemoryPressure · node-2",
            actions: [.ack, .snooze],
            alertID: "alert-2",
            createdAt: minutesAgo(20),
            subtitle: "kube-system / node-2",
            latestUpdate: ItemUpdate(text: "Checking top memory consumers", at: minutesAgo(2)),
            investigationStep: .investigating
        ),
        Item(
            id: "failure-backup",
            source: "cron",
            kind: .failure,
            urgency: .today,
            title: "Nightly backup verify failed",
            createdAt: minutesAgo(40),
            latestUpdate: ItemUpdate(text: "Re-running against a fresh snapshot", at: minutesAgo(9))
        ),
        Item(
            id: "factory-merge",
            source: "factory",
            kind: .failure,
            urgency: .whenever,
            title: "Merge queue stalled 40m",
            createdAt: minutesAgo(45)
        ),
    ]

    /// Resolved and fixed, with one event of every type on its timeline.
    static let replicas = Item(
        id: "alert-replicas",
        source: "alertmanager",
        kind: .alert,
        urgency: .today,
        state: .resolved,
        title: "KubeDeploymentReplicasMismatch",
        body: "Deployment api has 2 of 3 replicas ready.",
        context: ["namespace": "apps"],
        occurrenceCount: 2,
        actions: [.ack, .snooze],
        alertID: "alert-3",
        createdAt: minutesAgo(150),
        resolvedAt: minutesAgo(122),
        subtitle: "apps / api",
        outcome: .fixed,
        resolvedAfter: 28 * 60
    )

    static let handled = [
        replicas,
        Item(
            id: "done-deploy",
            source: "deployer",
            kind: .done,
            urgency: .whenever,
            state: .resolved,
            title: "web v1.8.2 deployed",
            createdAt: minutesAgo(250),
            resolvedAt: minutesAgo(250),
            outcome: .other,
            resolvedAfter: 0
        ),
        Item(
            id: "alert-targetdown",
            source: "alertmanager",
            kind: .alert,
            urgency: .whenever,
            state: .resolved,
            title: "TargetDown",
            alertID: "alert-4",
            createdAt: minutesAgo(320),
            resolvedAt: minutesAgo(317),
            subtitle: "monitoring / node-exporter",
            outcome: .noise,
            resolvedAfter: 3 * 60
        ),
    ]

    static let older = [
        Item(
            id: "alert-nodenotready",
            source: "alertmanager",
            kind: .alert,
            urgency: .now,
            state: .resolved,
            title: "KubeNodeNotReady · node-3",
            alertID: "alert-5",
            createdAt: daysAgo(2, hour: 22),
            resolvedAt: daysAgo(2, hour: 23),
            outcome: .escalated,
            resolvedAfter: 72 * 60
        ),
        Item(
            id: "alert-cephwarn",
            source: "alertmanager",
            kind: .alert,
            urgency: .today,
            state: .resolved,
            title: "CephHealthWarn",
            alertID: "alert-6",
            createdAt: daysAgo(3, hour: 17),
            resolvedAt: daysAgo(3, hour: 17),
            subtitle: "storage",
            outcome: .selfResolved,
            resolvedAfter: 11 * 60
        ),
    ]

    static let items = [approval, question, crashLoop] + withHermes + handled + older

    static func events(for item: Item) -> [ItemEvent] {
        func event(_ minutes: Double, _ type: ItemEventType, _ actor: String, _ payload: [String: String] = [:]) -> ItemEvent {
            ItemEvent(id: "\(item.id)-\(type.rawValue)-\(minutes)", at: minutesAgo(minutes), type: type, actor: actor, payload: payload)
        }
        switch item.id {
        case replicas.id:
            return [
                event(150, .created, "alertmanager", ["state": "open"]),
                event(150, .dispatched, "cowtail"),
                event(150, .notified, "cowtail", ["reason": "Push sent, time-sensitive"]),
                event(145, .repeated, "alertmanager", ["occurrenceCount": "2"]),
                event(140, .hermesUpdate, "hermes", ["text": "One replica is OOMKilled. Raising the limit."]),
                event(138, .actionTaken, "owner", ["type": "ack"]),
                event(138, .stateChanged, "owner", ["from": "open", "to": "acked"]),
                event(122, .resolved, "alertmanager", ["from": "acked", "to": "resolved"]),
            ]
        default:
            return [
                ItemEvent(id: "\(item.id)-created", at: item.createdAt, type: .created, actor: item.source, payload: ["state": "open"]),
            ]
        }
    }

    static let stats = ItemStats(
        createdCount: 111,
        resolvedCount: 92,
        outcomeMix: [.fixed: 41, .selfResolved: 23, .noise: 18, .escalated: 6, .other: 4],
        noiseRate: 0.196,
        timeToResolve: [
            .init(kind: .alert, count: 70, median: 14 * 60, p90: 130 * 60),
            .init(kind: .failure, count: 12, median: 38 * 60, p90: 302 * 60),
            .init(kind: .approval, count: 10, median: 100, p90: 240),
        ],
        repeatOffenders: [
            .init(dedupeKey: "targetdown", title: "TargetDown · node-exporter", occurrenceCount: 18, noiseShare: 0.94),
            .init(dedupeKey: "crashloop", title: "KubePodCrashLooping · transcoder", occurrenceCount: 11, noiseShare: 0.09),
            .init(dedupeKey: "cephwarn", title: "CephHealthWarn", occurrenceCount: 7, noiseShare: 0.43),
        ],
        dailyVolume: (0..<7).reversed().map { offset in
            let day = Calendar.current.date(byAdding: .day, value: -offset, to: .now) ?? .now
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            let counts = ["alertmanager": 6 + offset, "hermes": 2 + offset % 3, "cron": offset % 2]
            return .init(date: formatter.string(from: day), total: counts.values.reduce(0, +), bySource: counts)
        },
        firingCount: 7,
        firingByNamespace: [
            .init(namespace: "media", count: 3),
            .init(namespace: "storage", count: 2),
            .init(namespace: "monitoring", count: 1),
            .init(namespace: "edge", count: 1),
        ]
    )

    static let devices = [
        UserDevice(id: "device-1", name: "iPhone", lastSeenAt: minutesAgo(1)),
        UserDevice(id: "device-2", name: "iPad", lastSeenAt: daysAgo(3, hour: 9)),
    ]

    static let roundupAlerts = [
        AlertItem(
            id: "roundup-alert-1",
            timestamp: .now.addingTimeInterval(-2 * 60 * 60),
            alertName: "NodeFilesystemPressure",
            severity: .warning,
            namespace: "kube-system",
            node: "node-b",
            outcome: .fixed,
            summary: "Filesystem pressure cleared after log cleanup.",
            rootCause: "Verbose logs filled the node disk.",
            actionTaken: "Expired noisy log files and restarted the daemonset.",
            status: .resolved,
            resolvedAt: .now.addingTimeInterval(-90 * 60),
            messaged: true
        ),
        AlertItem(
            id: "roundup-alert-2",
            timestamp: .now.addingTimeInterval(-5 * 60 * 60),
            alertName: "CephRebalancingLag",
            severity: .warning,
            namespace: "rook-ceph",
            node: "node-a",
            outcome: .selfResolved,
            summary: "Rebalancing lag recovered without intervention.",
            rootCause: "Backfill slowed during compaction.",
            actionTaken: "No manual action was required.",
            status: .resolved,
            resolvedAt: .now.addingTimeInterval(-4 * 60 * 60),
            messaged: true
        ),
    ]

    static let roundupFixes = [
        AlertFix(
            id: "roundup-fix-1",
            description: "Expired verbose kubelet logs to recover disk space.",
            rootCause: "Unexpected log growth on a worker node.",
            scope: .weekly,
            timestamp: .now.addingTimeInterval(-100 * 60)
        ),
    ]
}
