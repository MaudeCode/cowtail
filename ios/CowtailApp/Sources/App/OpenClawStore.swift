import Foundation
import OSLog

enum OpenClawConnectionState: Equatable {
    case disconnected
    case signedOut
    case connecting
    case connected
    case reconnecting
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
    private var liveStreamIdsByThreadID: [String: String] = [:]
    private var retiredStreamIdsByThreadID: [String: Set<String>] = [:]
    private var lastSnapshotCursorByStreamID: [String: StreamSnapshotCursor] = [:]
    private var durableMessageIdsByStreamID: [String: String] = [:]

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

    @discardableResult
    func updateDisplayName(_ displayName: String) async -> Bool {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            errorMessage = "Sign in from Farmhouse to update OpenClaw settings."
            return false
        }

        do {
            let updated = try await api.updatePreferences(displayName: displayName, sessionToken: sessionToken)
            self.displayName = updated
            defaults.set(updated, forKey: Self.displayNameKey)
            errorMessage = nil
            return true
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return false }
            logger.error("display name update failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
            return false
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

    func connectForeground(forceRestart: Bool = false) async {
        switch connectionState {
        case .connecting, .connected, .reconnecting:
            if !forceRestart {
                return
            }
        case .disconnected, .signedOut, .failed:
            break
        }

        if forceRestart {
            realtime.stop()
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
            lastSeenSequence: lastSeenSequence,
            onConnectionStateChange: { [weak self] transportState in
                self?.handleTransportState(transportState, generation: generation)
            }
        ) { [weak self] message in
            self?.handle(message)
        }
    }

    func disconnectForeground() {
        connectionGeneration += 1
        realtime.stop()
        connectionState = .disconnected
    }

    func reconnectForeground() async {
        await connectForeground(forceRestart: true)
    }

    func sendReply(threadId: String, text: String) async throws {
        let requestId = UUID().uuidString
        try await realtime.send(.reply(.init(
            requestId: requestId,
            idempotencyKey: "ios:reply:\(requestId)",
            threadId: threadId,
            text: text
        )))
    }

    func createThread(title: String?, text: String) async throws {
        let requestId = UUID().uuidString
        try await realtime.send(.newThread(.init(
            requestId: requestId,
            idempotencyKey: "ios:new-thread:\(requestId)",
            title: title,
            text: text
        )))
    }

    func submitAction(actionId: String, payload: [String: JSONValue]) async throws {
        let requestId = UUID().uuidString
        try await realtime.send(.action(.init(
            requestId: requestId,
            idempotencyKey: "ios:action:\(actionId)",
            actionId: actionId,
            payload: payload
        )))
    }

    func markThreadRead(threadId: String) async throws {
        let requestId = UUID().uuidString
        try await realtime.send(.markThreadRead(.init(
            requestId: requestId,
            idempotencyKey: "ios:mark-read:\(requestId)",
            threadId: threadId
        )))
    }

    func markThreadReadIfUnread(threadId: String) async throws {
        guard threads.first(where: { $0.id == threadId })?.unreadCount ?? 0 > 0 else {
            return
        }

        try await markThreadRead(threadId: threadId)
    }

    func renameThread(threadId: String, title: String) async throws {
        let requestId = UUID().uuidString
        try await realtime.send(.renameThread(.init(
            requestId: requestId,
            idempotencyKey: "ios:rename:\(requestId)",
            threadId: threadId,
            title: title
        )))
    }

    func deleteThread(threadId: String) async throws {
        let requestId = UUID().uuidString
        try await realtime.send(.deleteThread(.init(
            requestId: requestId,
            idempotencyKey: "ios:delete:\(requestId)",
            threadId: threadId
        )))
    }

    func apply(_ event: OpenClawEventEnvelope) throws {
        if let thread = event.thread {
            upsertThread(thread)
            if thread.status == .archived {
                advanceCursor(to: event.sequence)
                return
            }
        }

        if let message = event.message {
            upsertMessage(
                message,
                actions: event.actions,
                finalizedStreamId: event.payload?.openClawStreamId
            )
        } else {
            for action in event.actions {
                upsertAction(action)
            }
        }

        if let action = event.action {
            upsertAction(action)
        }

        advanceCursor(to: event.sequence)
    }

    func applyStreamSnapshot(_ snapshot: OpenClawStreamSnapshot) {
        if retiredStreamIdsByThreadID[snapshot.threadId]?.contains(snapshot.streamId) == true {
            return
        }

        let snapshotCursor = StreamSnapshotCursor(snapshot)
        if let lastSnapshotCursor = lastSnapshotCursorByStreamID[snapshot.streamId],
           snapshotCursor.isOlder(than: lastSnapshotCursor) {
            return
        }

        var messages = messagesByThreadID[snapshot.threadId] ?? []
        let messageId = durableMessageIdsByStreamID[snapshot.streamId] ?? snapshot.streamId
        let hasExistingStreamMessage = messages.contains { $0.id == messageId }

        if snapshot.isFinal,
           liveStreamIdsByThreadID[snapshot.threadId] != snapshot.streamId,
           !hasExistingStreamMessage {
            return
        }

        if let existingStreamId = liveStreamIdsByThreadID[snapshot.threadId],
           existingStreamId != snapshot.streamId {
            messages.removeAll { $0.id == existingStreamId }
            retireStream(existingStreamId, threadId: snapshot.threadId)
        }

        liveStreamIdsByThreadID[snapshot.threadId] = snapshot.streamId
        retiredStreamIdsByThreadID[snapshot.threadId]?.remove(snapshot.streamId)
        lastSnapshotCursorByStreamID[snapshot.streamId] = snapshotCursor

        let existingMessage = messages.first { $0.id == messageId }
        let createdAt = existingMessage?.createdAt ?? snapshot.updatedAt

        let message = OpenClawMessage(
            id: messageId,
            threadId: snapshot.threadId,
            direction: .openClawToUser,
            authorLabel: "OpenClaw",
            text: snapshot.text,
            links: snapshot.links,
            toolCalls: snapshot.toolCalls,
            deliveryState: snapshot.isFinal ? .sent : .pending,
            createdAt: createdAt,
            updatedAt: snapshot.updatedAt
        )
        let messageWithActions = OpenClawMessageWithActions(message: message, actions: existingMessage?.actions ?? [])

        if let index = messages.firstIndex(where: { $0.id == messageId }) {
            messages[index] = messageWithActions
        } else {
            messages.append(messageWithActions)
        }
        messagesByThreadID[snapshot.threadId] = sortedMessages(messages)
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
                if error.requestId == nil {
                    connectionState = .failed(error.error)
                }

            case .streamSnapshot(let snapshot):
                applyStreamSnapshot(snapshot)
            }
        } catch {
            logger.error("realtime message handling failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    private func handleTransportState(
        _ transportState: OpenClawRealtimeTransportState,
        generation: Int
    ) {
        guard generation == connectionGeneration else {
            return
        }

        switch transportState {
        case .disconnected:
            connectionState = .disconnected
        case .connecting:
            connectionState = .connecting
        case .connected:
            connectionState = .connected
            errorMessage = nil
        case .reconnecting:
            connectionState = .reconnecting
        case .failed(let message):
            connectionState = .failed(message)
            errorMessage = message
        }
    }

    private func upsertThread(_ thread: OpenClawThread) {
        if thread.status == .archived {
            threads.removeAll { $0.id == thread.id }
            messagesByThreadID.removeValue(forKey: thread.id)
            if let liveStreamId = liveStreamIdsByThreadID.removeValue(forKey: thread.id) {
                lastSnapshotCursorByStreamID.removeValue(forKey: liveStreamId)
                durableMessageIdsByStreamID.removeValue(forKey: liveStreamId)
            }
            retiredStreamIdsByThreadID.removeValue(forKey: thread.id)
            return
        }

        if let index = threads.firstIndex(where: { $0.id == thread.id }) {
            threads[index] = thread
        } else {
            threads.append(thread)
        }
        threads = sortedThreads(threads)
    }

    private func upsertMessage(
        _ message: OpenClawMessage,
        actions: [OpenClawAction],
        finalizedStreamId: String?
    ) {
        if message.direction == .openClawToUser {
            if let finalizedStreamId {
                if message.deliveryState.isTerminal {
                    retireFinalizedStream(finalizedStreamId, threadId: message.threadId)
                } else {
                    reconcilePendingStream(finalizedStreamId, with: message.id, threadId: message.threadId)
                }
            } else if message.deliveryState.isTerminal,
                      let liveStreamId = liveStreamIdsByThreadID.removeValue(forKey: message.threadId) {
                messagesByThreadID[message.threadId]?.removeAll { $0.id == liveStreamId }
                retireStream(liveStreamId, threadId: message.threadId)
            }
        }

        let existingActions = messagesByThreadID[message.threadId]?
            .first(where: { $0.id == message.id })?
            .actions ?? []
        let mergedActions = mergeActions(existingActions, with: actions)
        let messageWithActions = OpenClawMessageWithActions(message: message, actions: mergedActions)

        var messages = messagesByThreadID[message.threadId] ?? []
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = messageWithActions
        } else {
            messages.append(messageWithActions)
        }
        messagesByThreadID[message.threadId] = sortedMessages(messages)
    }

    private func upsertAction(_ action: OpenClawAction) {
        guard var messages = messagesByThreadID[action.threadId],
              let index = messages.firstIndex(where: { $0.id == action.messageId }) else {
            return
        }

        let existing = messages[index]
        let actions = mergeActions(existing.actions, with: [action])
        messages[index] = OpenClawMessageWithActions(message: existing.message, actions: actions)
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

    private func reconcilePendingStream(_ streamId: String, with messageId: String, threadId: String) {
        durableMessageIdsByStreamID[streamId] = messageId
        messagesByThreadID[threadId]?.removeAll { $0.id == streamId }
        if let liveStreamId = liveStreamIdsByThreadID[threadId],
           liveStreamId != streamId {
            retireStream(streamId, threadId: threadId)
        } else {
            liveStreamIdsByThreadID[threadId] = streamId
            retiredStreamIdsByThreadID[threadId]?.remove(streamId)
        }
    }

    private func retireFinalizedStream(_ streamId: String, threadId: String) {
        messagesByThreadID[threadId]?.removeAll { $0.id == streamId }
        durableMessageIdsByStreamID.removeValue(forKey: streamId)
        if liveStreamIdsByThreadID[threadId] == streamId {
            liveStreamIdsByThreadID.removeValue(forKey: threadId)
        }
        retireStream(streamId, threadId: threadId)
    }

    private func retireStream(_ streamId: String, threadId: String) {
        var retiredStreamIds = retiredStreamIdsByThreadID[threadId] ?? []
        retiredStreamIds.insert(streamId)
        retiredStreamIdsByThreadID[threadId] = retiredStreamIds
        lastSnapshotCursorByStreamID.removeValue(forKey: streamId)
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
    init(message: OpenClawMessage, actions: [OpenClawAction]) {
        id = message.id
        threadId = message.threadId
        direction = message.direction
        authorLabel = message.authorLabel
        text = message.text
        links = message.links
        toolCalls = message.toolCalls
        deliveryState = message.deliveryState
        createdAt = message.createdAt
        updatedAt = message.updatedAt
        self.actions = actions
    }
}

private extension Dictionary where Key == String, Value == JSONValue {
    var openClawStreamId: String? {
        guard case .string(let streamId) = self["streamId"],
              !streamId.isEmpty else {
            return nil
        }
        return streamId
    }
}

private extension OpenClawDeliveryState {
    var isTerminal: Bool {
        switch self {
        case .sent, .failed:
            return true
        case .pending:
            return false
        }
    }
}

private struct StreamSnapshotCursor {
    let snapshotSequence: Int64?
    let updatedAt: Int64

    init(_ snapshot: OpenClawStreamSnapshot) {
        snapshotSequence = snapshot.snapshotSequence
        updatedAt = snapshot.updatedAt
    }

    func isOlder(than other: StreamSnapshotCursor) -> Bool {
        switch (snapshotSequence, other.snapshotSequence) {
        case let (current?, previous?):
            return current < previous
        case (nil, _?):
            return true
        case (_?, nil):
            return false
        case (nil, nil):
            return updatedAt < other.updatedAt
        }
    }
}
