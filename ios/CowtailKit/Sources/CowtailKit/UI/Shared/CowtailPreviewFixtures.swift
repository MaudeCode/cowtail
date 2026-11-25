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

    /// The Mac deployer's uploaded icon, inline so the seeded app loads it without a network.
    static let deployerIcon = URL(string: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOElEQVR42mOQ6KmgKWIYtWDUglEL8Frwn2hAvgXEuHHUAtpaMBrJoxaMWkDrfDBa4YxaMGoBlRAAN7Xofb/sVJwAAAAASUVORK5CYII=")

    static let approval = Item(
        id: "approval-ingress",
        source: "hermes",
        sourceName: "Hermes",
        kind: .approval,
        urgency: .now,
        needsOwner: true,
        title: "Restart ingress in edge?",
        body: "`kubectl rollout restart deploy/ingress -n edge`",
        actions: [.approve, .deny],
        availableActions: [.approve, .deny, .snooze],
        expiresAt: .now.addingTimeInterval(4 * 60),
        createdAt: minutesAgo(1)
    )

    static let question = Item(
        id: "question-osd",
        source: "hermes",
        sourceName: "Hermes",
        kind: .question,
        urgency: .now,
        needsOwner: true,
        title: "OSD 4 is 88% full. Rebalance now or wait for the new disk?",
        actions: [.choose(["Rebalance now", "Wait"]), .reply],
        availableActions: [.choose(["Rebalance now", "Wait"]), .reply, .snooze],
        createdAt: minutesAgo(3)
    )

    static let crashLoop = Item(
        id: "alert-crashloop",
        source: "alertmanager",
        sourceName: "Alertmanager",
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
        alertActions: [.retryInvestigation, .markNoise, .escalate],
        createdAt: minutesAgo(30),
        subtitle: "media / transcoder",
        investigationStep: .failed
    )

    static let withHermes = [
        Item(
            id: "alert-memory",
            source: "alertmanager",
            sourceName: "Alertmanager",
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
            sourceName: "Cron",
            kind: .failure,
            urgency: .today,
            title: "Nightly backup verify failed",
            availableActions: [.ack, .snooze],
            createdAt: minutesAgo(40),
            latestUpdate: ItemUpdate(text: "Re-running against a fresh snapshot", at: minutesAgo(9))
        ),
        Item(
            id: "factory-merge",
            source: "factory",
            sourceName: "Factory",
            kind: .failure,
            urgency: .whenever,
            title: "Merge queue stalled 40m",
            availableActions: [.ack, .snooze],
            createdAt: minutesAgo(45)
        ),
    ]

    /// 09:00 local, this many days from today.
    private static func daysAhead(_ days: Int) -> Date {
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: days, to: .now) ?? .now
        return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
    }

    /// Snoozed: back later today, in a few days, and after the coming week.
    static let upcoming = [
        Item(
            id: "alert-osdfull",
            source: "alertmanager",
            sourceName: "Alertmanager",
            kind: .alert,
            urgency: .today,
            state: .snoozed,
            title: "CephOSDNearFull · osd.4",
            actions: [.ack, .snooze],
            availableActions: [.ack, .snooze, .unsnooze],
            alertID: "alert-7",
            // Later today, however late the test runs.
            snoozedUntil: min(
                .now.addingTimeInterval(4 * 60 * 60),
                Calendar.current.date(bySettingHour: 23, minute: 59, second: 0, of: .now) ?? .now
            ),
            needsOwnerWhenOpen: true,
            createdAt: minutesAgo(60),
            subtitle: "storage"
        ),
        Item(
            id: "reminder-disks",
            source: "hermes",
            sourceName: "Hermes",
            kind: .fyi,
            urgency: .whenever,
            state: .snoozed,
            title: "Check the new disk shipment",
            availableActions: [.unsnooze],
            snoozedUntil: daysAhead(3),
            needsOwnerWhenOpen: true,
            createdAt: minutesAgo(90)
        ),
        Item(
            id: "alert-certexpiry",
            source: "alertmanager",
            sourceName: "Alertmanager",
            kind: .alert,
            urgency: .whenever,
            state: .snoozed,
            title: "CertificateExpiringSoon · edge",
            actions: [.ack, .snooze],
            availableActions: [.ack, .snooze, .unsnooze],
            alertID: "alert-8",
            snoozedUntil: daysAhead(10),
            needsOwnerWhenOpen: false,
            createdAt: minutesAgo(200)
        ),
    ]

    /// Resolved and fixed, with one event of every type on its timeline.
    static let replicas = Item(
        id: "alert-replicas",
        source: "alertmanager",
        sourceName: "Alertmanager",
        kind: .alert,
        urgency: .today,
        state: .resolved,
        title: "KubeDeploymentReplicasMismatch",
        body: "Deployment api has 2 of 3 replicas ready.",
        context: ["namespace": "apps"],
        occurrenceCount: 2,
        actions: [.ack, .snooze],
        availableActions: [],
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
            sourceName: "Deployer",
            sourceIconURL: deployerIcon,
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
            sourceName: "Alertmanager",
            kind: .alert,
            urgency: .whenever,
            state: .resolved,
            title: "TargetDown",
            alertID: "alert-4",
            createdAt: minutesAgo(320),
            resolvedAt: minutesAgo(317),
            subtitle: "monitoring / node-exporter",
            outcome: .noise,
            resolvedAfter: 3 * 60,
            // Recorded during the cluster upgrade window, which held back its push.
            maintenanceWindowID: maintenanceWindow.id
        ),
    ]

    static let older = [
        Item(
            id: "alert-nodenotready",
            source: "alertmanager",
            sourceName: "Alertmanager",
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
            sourceName: "Alertmanager",
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

    static let items = [approval, question, crashLoop] + withHermes + upcoming + handled + older

    /// An open incident that needs the owner: its first alert still firing, its second resolved.
    static let storageOutage = Incident(
        summary: IncidentSummary(
            id: "incident-storage",
            title: "Storage outage",
            state: .open,
            memberCount: 2,
            worstUrgency: .now,
            startedAt: minutesAgo(47),
            resolvedAt: nil,
            duration: 47 * 60
        ),
        postmortemState: .none,
        postmortem: nil,
        postmortemAt: nil,
        availableActions: [.resolve]
    )

    /// A resolved incident with Hermes's postmortem.
    static let mediaOutage = Incident(
        summary: IncidentSummary(
            id: "incident-media",
            title: "Media outage",
            state: .resolved,
            memberCount: 1,
            worstUrgency: .today,
            startedAt: minutesAgo(90),
            resolvedAt: minutesAgo(60),
            duration: 30 * 60
        ),
        postmortemState: .written,
        postmortem: """
        ## Summary
        The transcoder ran out of memory for **30 minutes**.

        ## Follow-ups
        - Raise the transcoder's memory limit
        - Alert on OOM kills before the crash loop
        """,
        postmortemAt: minutesAgo(55),
        availableActions: [.requestPostmortem]
    )

    static let incidents = [storageOutage, mediaOutage]

    static let incidentItems = [
        Item(
            id: "alert-osddown",
            source: "alertmanager",
            sourceName: "Alertmanager",
            kind: .alert,
            urgency: .now,
            needsOwner: true,
            title: "CephOSDDown",
            actions: [.ack, .snooze],
            alertID: "alert-20",
            createdAt: minutesAgo(47),
            subtitle: "rook-ceph / osd.4",
            incident: storageOutage.summary
        ),
        Item(
            id: "alert-cephhealtherr",
            source: "alertmanager",
            sourceName: "Alertmanager",
            kind: .alert,
            urgency: .now,
            state: .resolved,
            title: "CephHealthErr",
            alertID: "alert-21",
            createdAt: minutesAgo(46),
            resolvedAt: minutesAgo(20),
            outcome: .selfResolved,
            resolvedAfter: 26 * 60,
            incident: storageOutage.summary
        ),
        Item(
            id: "alert-transcoder-oom",
            source: "alertmanager",
            sourceName: "Alertmanager",
            kind: .alert,
            urgency: .today,
            state: .resolved,
            title: "KubePodOOMKilled",
            alertID: "alert-22",
            createdAt: minutesAgo(90),
            resolvedAt: minutesAgo(60),
            subtitle: "media / transcoder",
            outcome: .fixed,
            resolvedAfter: 30 * 60,
            incident: mediaOutage.summary
        ),
    ]

    /// An incident's own events: an Alertmanager group formed it, and Hermes's postmortem.
    static func incidentEvents(for incident: Incident) -> [ItemEvent] {
        let summary = incident.summary
        var events = [
            ItemEvent(
                id: "\(summary.id)-item_added",
                at: summary.startedAt.addingTimeInterval(60),
                type: .itemAdded,
                actor: "cowtail",
                payload: ["reason": "Same Alertmanager group"],
                itemTitle: incidentItems.first { $0.incident?.id == summary.id }?.title
            ),
        ]
        if let postmortemAt = incident.postmortemAt {
            events.append(ItemEvent(id: "\(summary.id)-postmortem", at: postmortemAt, type: .postmortemWritten, actor: "hermes", payload: [:]))
        }
        return events
    }

    /// A running window over all alerts, 42 minutes from its end.
    static let maintenanceWindow = MaintenanceWindow(
        id: "window-upgrade",
        title: "Cluster upgrade",
        startsAt: minutesAgo(18),
        endsAt: Date.now.addingTimeInterval(42 * 60),
        matchers: [],
        sources: ["alertmanager"],
        allAlerts: true,
        heldSources: [],
        active: true
    )

    static func events(for item: Item) -> [ItemEvent] {
        func event(_ minutes: Double, _ type: ItemEventType, _ actor: String, _ payload: [String: String] = [:]) -> ItemEvent {
            ItemEvent(id: "\(item.id)-\(type.rawValue)-\(minutes)", at: minutesAgo(minutes), type: type, actor: actor, payload: payload)
        }
        switch item.id {
        case replicas.id:
            return [
                event(150, .created, "alertmanager", ["state": "open"]),
                event(150, .dispatched, "cowtail"),
                event(150, .notified, "cowtail", ["decision": "pushed"]),
                event(145, .repeated, "alertmanager", ["occurrenceCount": "2"]),
                ItemEvent(
                    id: "\(item.id)-hermes_update-140",
                    at: minutesAgo(140),
                    type: .hermesUpdate,
                    actor: "hermes",
                    payload: ["text": "One replica is OOMKilled. Raising the limit."],
                    evidence: [
                        EvidenceStep(
                            step: "Read the replica's last termination state",
                            command: "kubectl -n api describe pod api-7d9f | grep -A3 \"Last State\"",
                            output: "Last State:  Terminated\n  Reason:    OOMKilled\n  Exit Code: 137"
                        ),
                        EvidenceStep(step: "Raise the limit in GitOps and wait for rollout"),
                    ]
                ),
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
        volumeSources: ["alertmanager", "hermes", "cron"],
        firingCount: 7,
        firingByNamespace: [
            .init(namespace: "media", count: 3),
            .init(namespace: "storage", count: 2),
            .init(namespace: "monitoring", count: 1),
            .init(namespace: "edge", count: 1),
        ]
    )

    static let hermes = HermesStatus(
        heartbeat: HermesStatus.Heartbeat(
            receivedAt: .now.addingTimeInterval(-38),
            level: .green,
            platforms: ["cowtail", "telegram", "api"],
            model: "opus-5.5",
            provider: "anthropic",
            cronJobs: [
                HermesStatus.CronJob(
                    id: "backup-verify",
                    name: "backup-verify",
                    schedule: "0 3 * * *",
                    lastRunAt: minutesAgo(6 * 60),
                    lastStatus: "failed",
                    nextRunAt: .now.addingTimeInterval(18 * 3_600),
                    failing: true
                ),
                HermesStatus.CronJob(
                    id: "roundup-digest",
                    name: "roundup-digest",
                    schedule: "0 8 * * *",
                    lastRunAt: minutesAgo(60),
                    lastStatus: "ok",
                    nextRunAt: .now.addingTimeInterval(23 * 3_600),
                    failing: false
                ),
                HermesStatus.CronJob(
                    id: "repo-sweep",
                    name: "repo-sweep",
                    schedule: "*/30 * * * *",
                    lastRunAt: minutesAgo(11),
                    lastStatus: "ok",
                    nextRunAt: .now.addingTimeInterval(19 * 60),
                    failing: false
                ),
            ],
            cronJobCount: 3,
            failingCronCount: 1,
            incidents: [
                HermesStatus.Incident(
                    id: "backup-verify-sig",
                    jobName: "backup-verify",
                    state: "open",
                    failureType: "failing",
                    firstSeenAt: minutesAgo(6 * 60),
                    itemID: "failure-backup",
                    itemTitle: "Nightly backup verify failed"
                ),
            ],
            incidentCount: 1,
            kanban: HermesStatus.Kanban(blocked: 2, running: 1),
            kanbanBlocked: true,
            budget: [HermesStatus.Limit(key: "today", value: "62%")],
            rateLimits: [HermesStatus.Limit(key: "anthropic", value: "ok")],
            runbook: [
                RunbookSection(category: "services", scripts: [
                    RunbookScript(id: "gateway-restart", name: "Restart Hermes gateway", confirmText: "Restart the Hermes gateway?"),
                    RunbookScript(id: "runner-restart", name: "Restart script runner"),
                ]),
                RunbookSection(category: "diagnostics", scripts: [
                    RunbookScript(id: "disk-usage", name: "Disk usage"),
                ]),
            ]
        ),
        recentAnswers: [
            HermesStatus.Answer(
                itemID: "answer-ingress",
                title: "Restart ingress in edge?",
                answer: .approve,
                answeredAt: minutesAgo(40)
            ),
            HermesStatus.Answer(
                itemID: "answer-pvcs",
                title: "Delete 14 stale PVCs?",
                answer: .deny,
                answeredAt: daysAgo(2, hour: 16)
            ),
        ],
        recentRuns: [
            RunbookRun(
                id: "run-2",
                scriptID: "runner-restart",
                scriptName: "Restart script runner",
                status: .succeeded,
                active: false,
                exitCode: 0,
                createdAt: minutesAgo(30),
                startedAt: minutesAgo(30),
                finishedAt: minutesAgo(29)
            ),
            RunbookRun(
                id: "run-1",
                scriptID: "gateway-log",
                scriptName: "Tail gateway log",
                status: .failed,
                active: false,
                exitCode: 1,
                createdAt: minutesAgo(32),
                startedAt: minutesAgo(32),
                finishedAt: minutesAgo(32)
            ),
        ]
    )

    static let runOutput = """
    $ df -h /var/lib
    Filesystem      Size  Used Avail Use% Mounted on
    /dev/nvme0n1p2  916G  604G  266G  70% /
    """

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

    /// The crash-looping pod's memory, crossing its 512Mi limit while the alert fired; no other
    /// item has a graph.
    static func graph(for item: Item, range: ItemGraphRange) -> ItemGraph? {
        guard item.id == crashLoop.id else { return nil }
        let span: Double = switch range {
        case .oneHour: 60
        case .sixHours: 360
        case .oneDay: 1440
        }
        let limit = 536_870_912.0
        let firingStart = item.createdAt
        let points = (0...60).map { step in
            let at = minutesAgo(span * Double(60 - step) / 60)
            let rising = 300_000_000 + 260_000_000 * Double(step) / 60
            let value = at >= firingStart ? limit * 1.15 + Double(step % 3) * 30_000_000 : rising
            return ItemGraph.Point(at: at, value: value)
        }
        return ItemGraph(
            range: range,
            query: "container_memory_working_set_bytes",
            from: minutesAgo(span),
            to: .now,
            threshold: .init(op: ">", value: limit),
            firing: .init(start: firingStart),
            series: [.init(labels: ["pod": "transcoder-7d9f"], points: points)]
        )
    }

    /// The earlier firings item detail shows for an item's alert.
    static func priorOccurrences(for item: Item) -> [PriorOccurrence] {
        guard item.id == replicas.id else { return [] }
        return [
            PriorOccurrence(
                alertID: "alert-replicas-prior-1",
                firedAt: daysAgo(12, hour: 9),
                outcome: .fixed,
                rootCause: "OOMKilled at 256Mi",
                summary: "One replica crash looped.",
                cause: "OOMKilled at 256Mi",
                fixCommit: "7be01d4e",
                fixes: [.init(description: "Raise the api memory limit", rootCause: "OOMKilled", commit: "7be01d4e")]
            ),
            PriorOccurrence(
                alertID: "alert-replicas-prior-2",
                firedAt: daysAgo(26, hour: 14),
                outcome: .selfResolved,
                rootCause: "Node drain",
                summary: "Replicas rescheduled after a node drain.",
                cause: "Node drain"
            ),
        ]
    }

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
