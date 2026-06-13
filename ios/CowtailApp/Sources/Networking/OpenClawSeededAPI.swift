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

    func send(_ command: OpenClawClientCommand) async throws -> OpenClawAck {
        switch command {
        case .reply(let command):
            return await emitReply(for: command)
        case .deleteThread(let command):
            return await emitDeletedThread(threadId: command.threadId, requestId: command.requestId)
        case .newThread(let command):
            return await emitNewThread(for: command)
        case .action, .markThreadRead, .renameThread:
            return OpenClawAck(type: "ack", requestId: command.requestId)
        }
    }

    @MainActor
    private func emitReply(for command: OpenClawReplyCommand) -> OpenClawAck {
        let userSequence = nextSequence
        nextSequence += 1
        let userMessageID = "seeded-user-reply-\(userSequence)"
        onMessage?(.event(.init(
            sequence: userSequence,
            type: "message_created",
            createdAt: eventTime(for: userSequence),
            threadId: command.threadId,
            messageId: userMessageID,
            message: OpenClawMessage(
                id: userMessageID,
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

        return OpenClawAck(
            type: "ack",
            requestId: command.requestId,
            sequence: userSequence,
            payload: OpenClawAckPayload(
                threadId: command.threadId,
                messageId: userMessageID,
                dropped: nil,
                duplicate: nil,
                reason: nil
            )
        )
    }

    @MainActor
    private func emitNewThread(for command: OpenClawNewThreadCommand) -> OpenClawAck {
        let sequence = nextSequence
        nextSequence += 1
        let threadId = "seeded-thread-\(sequence)"
        let messageId = "seeded-new-thread-message-\(sequence)"
        let now = eventTime(for: sequence)
        onMessage?(.event(.init(
            sequence: sequence,
            type: "thread_created",
            createdAt: now,
            threadId: threadId,
            messageId: messageId,
            thread: OpenClawThread(
                id: threadId,
                sessionKey: nil,
                status: .pending,
                targetAgent: "default",
                title: command.title ?? "New thread",
                unreadCount: 0,
                createdAt: now,
                updatedAt: now,
                lastMessageAt: now
            ),
            message: OpenClawMessage(
                id: messageId,
                threadId: threadId,
                direction: .userToOpenClaw,
                authorLabel: "You",
                text: command.text,
                links: [],
                deliveryState: .sent,
                createdAt: now,
                updatedAt: now
            )
        )))

        return OpenClawAck(
            type: "ack",
            requestId: command.requestId,
            sequence: sequence,
            payload: OpenClawAckPayload(
                threadId: threadId,
                messageId: messageId,
                dropped: nil,
                duplicate: nil,
                reason: nil
            )
        )
    }

    @MainActor
    private func emitDeletedThread(threadId: String, requestId: String) -> OpenClawAck {
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

        return OpenClawAck(type: "ack", requestId: requestId, sequence: sequence)
    }

    private func eventTime(for sequence: Int64) -> Int64 {
        1_775_001_000_000 + sequence
    }
}
