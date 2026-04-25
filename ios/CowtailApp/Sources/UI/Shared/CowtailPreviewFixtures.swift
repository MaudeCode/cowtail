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

    static let openClawThread = OpenClawThread(
        id: "preview-thread",
        sessionKey: "preview-session",
        status: .active,
        targetAgent: "cluster-ops",
        title: "Investigate storage latency",
        unreadCount: 2,
        createdAt: 1_775_000_000_000,
        updatedAt: 1_775_000_240_000,
        lastMessageAt: 1_775_000_240_000
    )

    static let secondaryOpenClawThread = OpenClawThread(
        id: "preview-thread-2",
        sessionKey: "preview-session",
        status: .pending,
        targetAgent: "networking",
        title: "Check ingress certificate renewal",
        unreadCount: 0,
        createdAt: 1_774_996_000_000,
        updatedAt: 1_774_996_180_000,
        lastMessageAt: 1_774_996_180_000
    )

    static let openClawLink = OpenClawLink(
        label: "Runbook",
        url: "https://example.com/runbooks/storage-latency"
    )

    static let openClawMessage = OpenClawMessage(
        id: "preview-message",
        threadId: openClawThread.id,
        direction: .openClawToUser,
        authorLabel: "OpenClaw",
        text: "Storage latency is elevated on two nodes. I can start with a read-only diagnostic pass.",
        links: [openClawLink],
        deliveryState: .sent,
        createdAt: 1_775_000_120_000,
        updatedAt: 1_775_000_120_000
    )

    static let openClawReply = OpenClawMessage(
        id: "preview-reply",
        threadId: openClawThread.id,
        direction: .userToOpenClaw,
        authorLabel: "You",
        text: "Run the read-only checks and summarize anything risky before making changes.",
        links: [],
        deliveryState: .sent,
        createdAt: 1_775_000_180_000,
        updatedAt: 1_775_000_180_000
    )

    static let openClawAction = OpenClawAction(
        id: "preview-action",
        threadId: openClawThread.id,
        messageId: openClawMessage.id,
        label: "Run diagnostics",
        kind: "diagnostic",
        payload: ["mode": .string("read-only")],
        state: .pending,
        resultMetadata: nil,
        createdAt: 1_775_000_121_000,
        updatedAt: 1_775_000_121_000
    )

    static var openClawMessageWithActions: OpenClawMessageWithActions {
        decodeOpenClawMessageWithActions(openClawMessage, actions: [openClawAction])
    }

    static var openClawReplyWithActions: OpenClawMessageWithActions {
        decodeOpenClawMessageWithActions(openClawReply, actions: [])
    }

    @MainActor
    static func openClawStore() -> OpenClawStore {
        let api = PreviewOpenClawAPI(
            displayName: "OpenClaw",
            threads: [openClawThread, secondaryOpenClawThread],
            messagesByThreadID: [
                openClawThread.id: [openClawMessageWithActions, openClawReplyWithActions]
            ]
        )
        let defaults = UserDefaults(suiteName: "cowtail.openclaw.preview.\(UUID().uuidString)") ?? .standard
        defaults.set("OpenClaw", forKey: "openclaw.displayName")
        let store = OpenClawStore(
            api: api,
            realtime: PreviewOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        try? store.apply(.init(
            sequence: 1,
            type: "thread_created",
            createdAt: openClawThread.createdAt,
            threadId: openClawThread.id,
            thread: openClawThread
        ))
        try? store.apply(.init(
            sequence: 2,
            type: "message_created",
            createdAt: openClawMessage.createdAt,
            threadId: openClawThread.id,
            messageId: openClawMessage.id,
            message: openClawMessage,
            actions: [openClawAction]
        ))
        try? store.apply(.init(
            sequence: 3,
            type: "message_created",
            createdAt: openClawReply.createdAt,
            threadId: openClawThread.id,
            messageId: openClawReply.id,
            message: openClawReply
        ))
        try? store.apply(.init(
            sequence: 4,
            type: "thread_created",
            createdAt: secondaryOpenClawThread.createdAt,
            threadId: secondaryOpenClawThread.id,
            thread: secondaryOpenClawThread
        ))

        return store
    }

    private static func decodeOpenClawMessageWithActions(
        _ message: OpenClawMessage,
        actions: [OpenClawAction]
    ) -> OpenClawMessageWithActions {
        let payload = OpenClawPreviewMessagePayload(message: message, actions: actions)
        guard let data = try? JSONEncoder().encode(payload),
              let messageWithActions = try? JSONDecoder().decode(OpenClawMessageWithActions.self, from: data) else {
            return fallbackOpenClawMessageWithActions
        }

        return messageWithActions
    }

    private static var fallbackOpenClawMessageWithActions: OpenClawMessageWithActions {
        let data = Data("""
        {
          "id": "fallback-message",
          "threadId": "preview-thread",
          "direction": "openclaw_to_user",
          "authorLabel": "OpenClaw",
          "text": "Preview message",
          "links": [],
          "deliveryState": "sent",
          "createdAt": 1775000000000,
          "updatedAt": 1775000000000,
          "actions": []
        }
        """.utf8)
        return try! JSONDecoder().decode(OpenClawMessageWithActions.self, from: data)
    }
}

private struct OpenClawPreviewMessagePayload: Encodable {
    let id: String
    let threadId: String
    let direction: OpenClawMessageDirection
    let authorLabel: String?
    let text: String
    let links: [OpenClawLink]
    let deliveryState: OpenClawDeliveryState
    let createdAt: Int64
    let updatedAt: Int64
    let actions: [OpenClawAction]

    init(message: OpenClawMessage, actions: [OpenClawAction]) {
        id = message.id
        threadId = message.threadId
        direction = message.direction
        authorLabel = message.authorLabel
        text = message.text
        links = message.links
        deliveryState = message.deliveryState
        createdAt = message.createdAt
        updatedAt = message.updatedAt
        self.actions = actions
    }
}

private actor PreviewOpenClawAPI: OpenClawAPIClient {
    let displayName: String
    let threads: [OpenClawThread]
    let messagesByThreadID: [String: [OpenClawMessageWithActions]]

    init(
        displayName: String,
        threads: [OpenClawThread],
        messagesByThreadID: [String: [OpenClawMessageWithActions]]
    ) {
        self.displayName = displayName
        self.threads = threads
        self.messagesByThreadID = messagesByThreadID
    }

    func fetchPreferences(sessionToken: String) async throws -> String {
        displayName
    }

    func updatePreferences(displayName: String, sessionToken: String) async throws -> String {
        displayName
    }

    func fetchThreads(sessionToken: String) async throws -> [OpenClawThread] {
        threads
    }

    func fetchMessages(threadId: String, sessionToken: String) async throws -> [OpenClawMessageWithActions] {
        messagesByThreadID[threadId] ?? []
    }
}

@MainActor
private final class PreviewOpenClawRealtime: OpenClawRealtimeConnecting {
    func start(
        sessionToken: String,
        lastSeenSequence: Int64?,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    ) {}

    func stop() {}

    func send(_ command: OpenClawClientCommand) async throws {}
}
