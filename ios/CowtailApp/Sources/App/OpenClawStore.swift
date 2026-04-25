import Foundation
import OSLog

enum OpenClawConnectionState: Equatable {
    case disconnected
    case signedOut
    case connecting
    case connected
    case failed(String)
}

@MainActor
final class OpenClawStore: ObservableObject {
    @Published private(set) var displayName: String
    @Published private(set) var threads: [OpenClawThread]
    @Published private(set) var messagesByThreadID: [String: [OpenClawMessageWithActions]]
    @Published private(set) var connectionState: OpenClawConnectionState
    @Published private(set) var lastSeenSequence: Int64?
    @Published var errorMessage: String?

    var unreadCount: Int {
        threads.reduce(0) { $0 + $1.unreadCount }
    }

    private let api: any OpenClawAPIClient
    private let realtime: any OpenClawRealtimeConnecting
    private let appSessionManager: AppSessionManager
    private let defaults: UserDefaults
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "openclawStore"
    )
    private var connectionGeneration = 0

    private static let displayNameKey = "openclaw.displayName"
    private static let lastSeenSequenceKey = "openclaw.lastSeenSequence"

    init(
        api: any OpenClawAPIClient = OpenClawAPI(),
        realtime: any OpenClawRealtimeConnecting = OpenClawRealtimeClient(),
        appSessionManager: AppSessionManager = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.api = api
        self.realtime = realtime
        self.appSessionManager = appSessionManager
        self.defaults = defaults
        self.displayName = defaults.string(forKey: Self.displayNameKey) ?? ""
        self.threads = []
        self.messagesByThreadID = [:]
        self.connectionState = .disconnected

        if defaults.object(forKey: Self.lastSeenSequenceKey) != nil {
            self.lastSeenSequence = Int64(defaults.integer(forKey: Self.lastSeenSequenceKey))
        } else {
            self.lastSeenSequence = nil
        }
    }

    func refreshIfPossible() async {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            return
        }

        do {
            async let preferences = api.fetchPreferences(sessionToken: sessionToken)
            async let threadList = api.fetchThreads(sessionToken: sessionToken)

            let (fetchedDisplayName, fetchedThreads) = try await (preferences, threadList)
            displayName = fetchedDisplayName
            defaults.set(fetchedDisplayName, forKey: Self.displayNameKey)
            threads = sortedThreads(fetchedThreads)
            errorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    func updateDisplayName(_ displayName: String) async {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            return
        }

        do {
            let updated = try await api.updatePreferences(displayName: displayName, sessionToken: sessionToken)
            self.displayName = updated
            defaults.set(updated, forKey: Self.displayNameKey)
            errorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("display name update failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    func loadMessages(threadId: String) async {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            return
        }

        do {
            let messages = try await api.fetchMessages(threadId: threadId, sessionToken: sessionToken)
            messagesByThreadID[threadId] = sortedMessages(messages)
            errorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("message load failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    func connectForeground() async {
        switch connectionState {
        case .connecting, .connected:
            return
        case .disconnected, .signedOut, .failed:
            break
        }

        connectionGeneration += 1
        let generation = connectionGeneration
        connectionState = .connecting

        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            guard generation == connectionGeneration, connectionState == .connecting else {
                return
            }
            connectionState = .signedOut
            return
        }

        guard generation == connectionGeneration, connectionState == .connecting else {
            return
        }

        realtime.start(
            sessionToken: sessionToken,
            lastSeenSequence: lastSeenSequence
        ) { [weak self] message in
            self?.handle(message)
        }

        if connectionState == .connecting {
            connectionState = .connected
        }
    }

    func disconnectForeground() {
        connectionGeneration += 1
        realtime.stop()
        connectionState = .disconnected
    }

    func sendReply(threadId: String, text: String) async throws {
        try await realtime.send(.reply(.init(
            requestId: UUID().uuidString,
            threadId: threadId,
            text: text
        )))
    }

    func createThread(title: String?, text: String) async throws {
        try await realtime.send(.newThread(.init(
            requestId: UUID().uuidString,
            title: title,
            text: text
        )))
    }

    func submitAction(actionId: String, payload: [String: JSONValue]) async throws {
        try await realtime.send(.action(.init(
            requestId: UUID().uuidString,
            actionId: actionId,
            payload: payload
        )))
    }

    func markThreadRead(threadId: String) async throws {
        try await realtime.send(.markThreadRead(.init(
            requestId: UUID().uuidString,
            threadId: threadId
        )))
    }

    func apply(_ event: OpenClawEventEnvelope) throws {
        if let thread = event.thread {
            upsertThread(thread)
        }

        if let message = event.message {
            try upsertMessage(message, actions: event.actions)
        } else {
            for action in event.actions {
                try upsertAction(action)
            }
        }

        if let action = event.action {
            try upsertAction(action)
        }

        advanceCursor(to: event.sequence)
    }

    private func handle(_ message: OpenClawServerMessage) {
        do {
            switch message {
            case .event(let event):
                try apply(event)
                errorMessage = event.error

            case .ack(let ack):
                if let sequence = ack.sequence {
                    advanceCursor(to: sequence)
                }

            case .realtimeError(let error):
                errorMessage = error.error
                connectionState = .failed(error.error)
            }
        } catch {
            logger.error("realtime message handling failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    private func upsertThread(_ thread: OpenClawThread) {
        if let index = threads.firstIndex(where: { $0.id == thread.id }) {
            threads[index] = thread
        } else {
            threads.append(thread)
        }
        threads = sortedThreads(threads)
    }

    private func upsertMessage(_ message: OpenClawMessage, actions: [OpenClawAction]) throws {
        let existingActions = messagesByThreadID[message.threadId]?
            .first(where: { $0.id == message.id })?
            .actions ?? []
        let mergedActions = mergeActions(existingActions, with: actions)
        let messageWithActions = try OpenClawMessageWithActions(message: message, actions: mergedActions)

        var messages = messagesByThreadID[message.threadId] ?? []
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = messageWithActions
        } else {
            messages.append(messageWithActions)
        }
        messagesByThreadID[message.threadId] = sortedMessages(messages)
    }

    private func upsertAction(_ action: OpenClawAction) throws {
        guard var messages = messagesByThreadID[action.threadId],
              let index = messages.firstIndex(where: { $0.id == action.messageId }) else {
            return
        }

        let existing = messages[index]
        let actions = mergeActions(existing.actions, with: [action])
        messages[index] = try OpenClawMessageWithActions(message: existing.message, actions: actions)
        messagesByThreadID[action.threadId] = sortedMessages(messages)
    }

    private func mergeActions(
        _ currentActions: [OpenClawAction],
        with incomingActions: [OpenClawAction]
    ) -> [OpenClawAction] {
        var actions = currentActions
        for action in incomingActions {
            if let index = actions.firstIndex(where: { $0.id == action.id }) {
                actions[index] = action
            } else {
                actions.append(action)
            }
        }
        return actions.sorted { $0.createdAt < $1.createdAt }
    }

    private func advanceCursor(to sequence: Int64) {
        if let lastSeenSequence, sequence < lastSeenSequence {
            return
        }

        lastSeenSequence = sequence
        defaults.set(sequence, forKey: Self.lastSeenSequenceKey)
    }

    private func sortedThreads(_ threads: [OpenClawThread]) -> [OpenClawThread] {
        threads.sorted {
            ($0.lastMessageAt ?? $0.updatedAt) > ($1.lastMessageAt ?? $1.updatedAt)
        }
    }

    private func sortedMessages(_ messages: [OpenClawMessageWithActions]) -> [OpenClawMessageWithActions] {
        messages.sorted { $0.createdAt < $1.createdAt }
    }
}

private extension OpenClawMessageWithActions {
    init(message: OpenClawMessage, actions: [OpenClawAction]) throws {
        let data = try JSONEncoder().encode(OpenClawMessageWithActionsPayload(message: message, actions: actions))
        self = try JSONDecoder().decode(OpenClawMessageWithActions.self, from: data)
    }
}

private struct OpenClawMessageWithActionsPayload: Encodable {
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
        self.id = message.id
        self.threadId = message.threadId
        self.direction = message.direction
        self.authorLabel = message.authorLabel
        self.text = message.text
        self.links = message.links
        self.deliveryState = message.deliveryState
        self.createdAt = message.createdAt
        self.updatedAt = message.updatedAt
        self.actions = actions
    }
}
