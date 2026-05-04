actor OpenClawSeededAPI: OpenClawAPIClient {
    private let seed: UITestScenario.OpenClawSeed
    private var displayName: String

    init(seed: UITestScenario.OpenClawSeed = UITestScenario(named: .openClawPopulated).seed.openClaw) {
        self.seed = seed
        displayName = seed.displayName
    }

    func fetchPreferences(sessionToken _: String) async throws -> String {
        displayName
    }

    func updatePreferences(displayName: String, sessionToken _: String) async throws -> String {
        self.displayName = displayName
        return displayName
    }

    func fetchThreads(sessionToken _: String) async throws -> [OpenClawThread] {
        seed.threads
    }

    func fetchMessages(threadId: String, sessionToken _: String) async throws -> [OpenClawMessageWithActions] {
        seed.messagesByThreadID[threadId] ?? []
    }
}

final class OpenClawSeededRealtime: OpenClawRealtimeConnecting {
    private var onMessage: (@MainActor (OpenClawServerMessage) -> Void)?
    private var nextSequence: Int64 = 1_000

    func start(
        sessionToken _: String,
        lastSeenSequence _: Int64?,
        onConnectionStateChange: @escaping @MainActor (OpenClawRealtimeTransportState) -> Void,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    ) {
        self.onMessage = onMessage
        onConnectionStateChange(.connected)
    }

    func stop() {
        onMessage = nil
    }

    func send(_ command: OpenClawClientCommand) async throws {
        switch command {
        case .reply(let command):
            emitReply(for: command)
        case .deleteThread(let command):
            emitDeletedThread(threadId: command.threadId)
        case .newThread, .action, .markThreadRead, .renameThread:
            break
        }
    }

    @MainActor
    private func emitReply(for command: OpenClawReplyCommand) {
        let userSequence = nextSequence
        nextSequence += 1
        onMessage?(.event(.init(
            sequence: userSequence,
            type: "message_created",
            createdAt: eventTime(for: userSequence),
            threadId: command.threadId,
            messageId: "seeded-user-reply-\(userSequence)",
            message: OpenClawMessage(
                id: "seeded-user-reply-\(userSequence)",
                threadId: command.threadId,
                direction: .userToOpenClaw,
                authorLabel: "You",
                text: command.text,
                links: [],
                toolCalls: [],
                deliveryState: .sent,
                createdAt: eventTime(for: userSequence),
                updatedAt: eventTime(for: userSequence)
            )
        )))

        let assistantSequence = nextSequence
        nextSequence += 1
        onMessage?(.event(.init(
            sequence: assistantSequence,
            type: "message_created",
            createdAt: eventTime(for: assistantSequence),
            threadId: command.threadId,
            messageId: "seeded-openclaw-reply-\(assistantSequence)",
            message: OpenClawMessage(
                id: "seeded-openclaw-reply-\(assistantSequence)",
                threadId: command.threadId,
                direction: .openClawToUser,
                authorLabel: "OpenClaw",
                text: "Seeded OpenClaw response: \(command.text)",
                links: [],
                toolCalls: [],
                deliveryState: .sent,
                createdAt: eventTime(for: assistantSequence),
                updatedAt: eventTime(for: assistantSequence)
            )
        )))
    }

    @MainActor
    private func emitDeletedThread(threadId: String) {
        let sequence = nextSequence
        nextSequence += 1
        onMessage?(.event(.init(
            sequence: sequence,
            type: "thread_updated",
            createdAt: eventTime(for: sequence),
            threadId: threadId,
            thread: OpenClawThread(
                id: threadId,
                sessionKey: nil,
                status: .archived,
                targetAgent: "seeded",
                title: "Deleted thread",
                unreadCount: 0,
                createdAt: eventTime(for: sequence),
                updatedAt: eventTime(for: sequence),
                lastMessageAt: nil
            )
        )))
    }

    private func eventTime(for sequence: Int64) -> Int64 {
        1_775_001_000_000 + sequence
    }
}
