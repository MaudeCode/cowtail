import XCTest
@testable import Cowtail

@MainActor
final class OpenClawStoreTests: XCTestCase {
    override func tearDown() async throws {
        AppSessionManager.shared.resetForUITesting()
        try await super.tearDown()
    }

    func testUsesCachedDisplayNameBeforeNetworkRefresh() {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        defaults.set("Maude", forKey: "openclaw.displayName")

        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        XCTAssertEqual(store.displayName, "Maude")
    }

    func testUpdateDisplayNameReportsFailureWhenSessionRefreshFails() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        defaults.set("Maude", forKey: "openclaw.displayName")
        AppSessionManager.shared.resetForUITesting()
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        let saved = await store.updateDisplayName("Maude Ops")

        XCTAssertFalse(saved)
        XCTAssertEqual(store.displayName, "Maude")
        XCTAssertEqual(defaults.string(forKey: "openclaw.displayName"), "Maude")
        XCTAssertEqual(store.errorMessage, "Sign in from Farmhouse to update OpenClaw settings.")
    }

    func testAppliesEventBeforeAdvancingCursor() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 7,
                type: "message_created",
                createdAt: 1777128000000,
                threadId: "thread-1",
                messageId: "message-1",
                thread: OpenClawFixtures.thread,
                message: OpenClawFixtures.message,
                action: nil,
                actions: [],
                payload: nil,
                error: nil
            )
        )

        XCTAssertEqual(store.lastSeenSequence, 7)
        XCTAssertEqual(store.threads.first?.id, "thread-1")
    }

    func testRenameAndDeleteUseRealtimeCommands() async throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        try await store.renameThread(threadId: "thread-1", title: "Better title")
        try await store.deleteThread(threadId: "thread-1")

        XCTAssertEqual(realtime.sentCommands.count, 2)

        guard case .renameThread(let rename) = realtime.sentCommands[0] else {
            return XCTFail("Expected rename command")
        }
        XCTAssertEqual(rename.threadId, "thread-1")
        XCTAssertEqual(rename.title, "Better title")

        guard case .deleteThread(let delete) = realtime.sentCommands[1] else {
            return XCTFail("Expected delete command")
        }
        XCTAssertEqual(delete.threadId, "thread-1")
    }

    func testActionCommandUsesActionScopedIdempotencyKey() async throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        try await store.submitAction(actionId: "action-1", payload: ["decision": .string("approve")])

        XCTAssertEqual(realtime.sentCommands.count, 1)
        guard case .action(let action) = realtime.sentCommands[0] else {
            return XCTFail("Expected action command")
        }
        XCTAssertEqual(action.actionId, "action-1")
        XCTAssertEqual(action.idempotencyKey, "ios:action:action-1")
    }

    func testArchivedThreadEventRemovesThreadAndMessages() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 7,
                type: "message_created",
                createdAt: 1777128000000,
                threadId: "thread-1",
                messageId: "message-1",
                thread: OpenClawFixtures.thread,
                message: OpenClawFixtures.message,
                action: nil,
                actions: [],
                payload: nil,
                error: nil
            )
        )

        let archivedThread = OpenClawThread(
            id: "thread-1",
            sessionKey: "cowtail:thread-1",
            status: .archived,
            targetAgent: "default",
            title: "Deploy check",
            unreadCount: 0,
            createdAt: 1777127000000,
            updatedAt: 1777129000000,
            lastMessageAt: 1777128000000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 8,
                type: "thread_updated",
                createdAt: 1777129000000,
                threadId: "thread-1",
                messageId: nil,
                thread: archivedThread,
                message: nil,
                action: nil,
                actions: [],
                payload: ["deleted": .bool(true)],
                error: nil
            )
        )

        XCTAssertTrue(store.threads.isEmpty)
        XCTAssertNil(store.messagesByThreadID["thread-1"])
        XCTAssertEqual(store.lastSeenSequence, 8)
    }

    func testArchivedMessageReplayDoesNotRecreateDeletedThreadMessages() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 7,
                type: "message_created",
                createdAt: 1777128000000,
                threadId: "thread-1",
                messageId: "message-1",
                thread: OpenClawFixtures.thread,
                message: OpenClawFixtures.message,
                action: nil,
                actions: [],
                payload: nil,
                error: nil
            )
        )

        let archivedThread = OpenClawThread(
            id: "thread-1",
            sessionKey: "cowtail:thread-1",
            status: .archived,
            targetAgent: "default",
            title: "Deploy check",
            unreadCount: 0,
            createdAt: 1777127000000,
            updatedAt: 1777129000000,
            lastMessageAt: 1777128000000
        )
        let replayedMessage = OpenClawMessage(
            id: "message-2",
            threadId: "thread-1",
            direction: .openClawToUser,
            authorLabel: "OpenClaw",
            text: "Old reply from a deleted thread",
            links: [],
            deliveryState: .sent,
            createdAt: 1777128100000,
            updatedAt: 1777128100000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 9,
                type: "message_created",
                createdAt: 1777129100000,
                threadId: "thread-1",
                messageId: "message-2",
                thread: archivedThread,
                message: replayedMessage,
                action: nil,
                actions: [],
                payload: nil,
                error: nil
            )
        )

        XCTAssertTrue(store.threads.isEmpty)
        XCTAssertNil(store.messagesByThreadID["thread-1"])
        XCTAssertEqual(store.lastSeenSequence, 9)
    }

    func testMessageEventsMergeActionsAndKeepToolCalls() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )
        let message = OpenClawMessage(
            id: "message-1",
            threadId: "thread-1",
            direction: .openClawToUser,
            authorLabel: "OpenClaw",
            text: String(repeating: "Replay payload ", count: 500),
            links: [.init(label: "Runbook", url: "https://example.invalid/runbook")],
            toolCalls: [
                OpenClawToolCall(
                    id: "tool-1",
                    name: "query_metrics",
                    args: ["query": .string("rate(http_requests_total[5m])")],
                    result: .object(["series": .array([.number(1), .number(2), .number(3)])]),
                    status: .complete,
                    startedAt: 1777127900000,
                    completedAt: 1777127950000,
                    insertedAtContentLength: nil,
                    contentSnapshotAtStart: nil
                )
            ],
            deliveryState: .sent,
            createdAt: 1777128000000,
            updatedAt: 1777128000000
        )
        let action = OpenClawAction(
            id: "action-1",
            threadId: "thread-1",
            messageId: "message-1",
            label: "Approve",
            kind: "approve",
            payload: ["mode": .string("read-only")],
            state: .pending,
            resultMetadata: nil,
            createdAt: 1777128010000,
            updatedAt: 1777128010000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 7,
                type: "message_created",
                createdAt: 1777128000000,
                threadId: "thread-1",
                messageId: "message-1",
                thread: OpenClawFixtures.thread,
                message: message,
                actions: [action]
            )
        )

        let storedMessage = try XCTUnwrap(store.messagesByThreadID["thread-1"]?.first)
        XCTAssertEqual(storedMessage.id, "message-1")
        XCTAssertEqual(storedMessage.text, message.text)
        XCTAssertEqual(storedMessage.links, message.links)
        XCTAssertEqual(storedMessage.toolCalls, message.toolCalls)
        XCTAssertEqual(storedMessage.actions, [action])
        XCTAssertEqual(store.lastSeenSequence, 7)
    }

    func testStreamSnapshotCreatesPendingMessageAndDurableAssistantMessageReconcilesIt() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )
        let runningToolCall = OpenClawToolCall(
            id: "tool-1",
            name: "read_file",
            args: ["path": .string("/var/log/app.log")],
            result: nil,
            status: .running,
            startedAt: 1777127999000,
            completedAt: nil,
            insertedAtContentLength: 9,
            contentSnapshotAtStart: "Checking "
        )

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Checking logs.",
            links: [.init(label: "Runbook", url: "https://example.invalid/runbook")],
            toolCalls: [runningToolCall],
            isFinal: false,
            updatedAt: 1777128000000
        ))

        let pendingMessage = try XCTUnwrap(store.messagesByThreadID["thread-1"]?.first)
        XCTAssertEqual(pendingMessage.id, "stream-message-1")
        XCTAssertEqual(pendingMessage.direction, .openClawToUser)
        XCTAssertEqual(pendingMessage.authorLabel, "OpenClaw")
        XCTAssertEqual(pendingMessage.text, "Checking logs.")
        XCTAssertEqual(pendingMessage.links, [.init(label: "Runbook", url: "https://example.invalid/runbook")])
        XCTAssertEqual(pendingMessage.toolCalls, [runningToolCall])
        XCTAssertEqual(pendingMessage.deliveryState, .pending)
        XCTAssertEqual(pendingMessage.createdAt, 1777128000000)
        XCTAssertEqual(pendingMessage.updatedAt, 1777128000000)

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Checked the logs.",
            links: [],
            toolCalls: [runningToolCall],
            isFinal: true,
            updatedAt: 1777128040000
        ))

        let finalStreamMessage = try XCTUnwrap(store.messagesByThreadID["thread-1"]?.first)
        XCTAssertEqual(finalStreamMessage.id, "stream-message-1")
        XCTAssertEqual(finalStreamMessage.text, "Checked the logs.")
        XCTAssertEqual(finalStreamMessage.deliveryState, .sent)
        XCTAssertEqual(finalStreamMessage.updatedAt, 1777128040000)

        let durableMessage = OpenClawMessage(
            id: "message-1",
            threadId: "thread-1",
            direction: .openClawToUser,
            authorLabel: "OpenClaw",
            text: "Checked the logs.",
            links: [],
            toolCalls: [
                OpenClawToolCall(
                    id: "tool-1",
                    name: "read_file",
                    args: ["path": .string("/var/log/app.log")],
                    result: .string("ok"),
                    status: .complete,
                    startedAt: 1777127999000,
                    completedAt: 1777128050000,
                    insertedAtContentLength: 9,
                    contentSnapshotAtStart: "Checking "
                )
            ],
            deliveryState: .sent,
            createdAt: 1777128050000,
            updatedAt: 1777128050000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 8,
                type: "message_created",
                createdAt: 1777128050000,
                threadId: "thread-1",
                messageId: "message-1",
                message: durableMessage
            )
        )

        let messages = try XCTUnwrap(store.messagesByThreadID["thread-1"])
        XCTAssertEqual(messages.map(\.id), ["message-1"])
        XCTAssertEqual(messages.first?.text, "Checked the logs.")
        XCTAssertEqual(messages.first?.deliveryState, .sent)
    }

    func testLateFinalStreamSnapshotAfterDurableAssistantMessageDoesNotRecreatePlaceholder() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Checking logs.",
            links: [],
            toolCalls: [],
            isFinal: false,
            updatedAt: 1777128000000
        ))

        let durableMessage = OpenClawMessage(
            id: "message-1",
            threadId: "thread-1",
            direction: .openClawToUser,
            authorLabel: "OpenClaw",
            text: "Checked the logs.",
            links: [],
            deliveryState: .sent,
            createdAt: 1777128050000,
            updatedAt: 1777128050000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 8,
                type: "message_created",
                createdAt: 1777128050000,
                threadId: "thread-1",
                messageId: "message-1",
                message: durableMessage
            )
        )

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Checked the logs.",
            links: [],
            toolCalls: [],
            isFinal: true,
            updatedAt: 1777128040000
        ))

        let messages = try XCTUnwrap(store.messagesByThreadID["thread-1"])
        XCTAssertEqual(messages.map(\.id), ["message-1"])
        XCTAssertEqual(messages.first?.text, "Checked the logs.")
        XCTAssertEqual(messages.first?.deliveryState, .sent)
    }

    func testDurableUserMessageDoesNotRemoveStreamPlaceholder() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Working.",
            links: [],
            toolCalls: [],
            isFinal: false,
            updatedAt: 1777128000000
        ))

        let userMessage = OpenClawMessage(
            id: "message-user",
            threadId: "thread-1",
            direction: .userToOpenClaw,
            authorLabel: nil,
            text: "Any update?",
            links: [],
            deliveryState: .sent,
            createdAt: 1777128010000,
            updatedAt: 1777128010000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 8,
                type: "message_created",
                createdAt: 1777128010000,
                threadId: "thread-1",
                messageId: "message-user",
                message: userMessage
            )
        )

        XCTAssertEqual(store.messagesByThreadID["thread-1"]?.map(\.id), ["stream-message-1", "message-user"])
    }

    func testStreamSnapshotUpdatesPreservePlaceholderOrderingAroundUserMessages() throws {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: FakeOpenClawRealtime(),
            appSessionManager: .shared,
            defaults: defaults
        )

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Working.",
            links: [],
            toolCalls: [],
            isFinal: false,
            updatedAt: 1777128000000
        ))

        let userMessage = OpenClawMessage(
            id: "message-user",
            threadId: "thread-1",
            direction: .userToOpenClaw,
            authorLabel: nil,
            text: "Any update?",
            links: [],
            deliveryState: .sent,
            createdAt: 1777128010000,
            updatedAt: 1777128010000
        )

        try store.apply(
            OpenClawEventEnvelope(
                sequence: 8,
                type: "message_created",
                createdAt: 1777128010000,
                threadId: "thread-1",
                messageId: "message-user",
                message: userMessage
            )
        )

        store.applyStreamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Still working.",
            links: [.init(label: "Runbook", url: "https://example.invalid/runbook")],
            toolCalls: [],
            isFinal: false,
            updatedAt: 1777128020000
        ))

        let messages = try XCTUnwrap(store.messagesByThreadID["thread-1"])
        XCTAssertEqual(messages.map(\.id), ["stream-message-1", "message-user"])
        XCTAssertEqual(messages.first?.createdAt, 1777128000000)
        XCTAssertEqual(messages.first?.updatedAt, 1777128020000)
        XCTAssertEqual(messages.first?.text, "Still working.")
        XCTAssertEqual(messages.first?.links, [.init(label: "Runbook", url: "https://example.invalid/runbook")])
    }

    func testHandleRoutesStreamSnapshotsFromRealtime() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date(timeIntervalSinceNow: 3_600),
            lastError: nil
        )
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await store.connectForeground()
        realtime.emitMessage(.streamSnapshot(.init(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Live update.",
            links: [],
            toolCalls: [],
            isFinal: false,
            updatedAt: 1777128000000
        )))

        XCTAssertEqual(store.messagesByThreadID["thread-1"]?.first?.text, "Live update.")
        XCTAssertEqual(store.messagesByThreadID["thread-1"]?.first?.deliveryState, .pending)
    }

    func testConnectForegroundDoesNotRestartWhenAlreadyConnected() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date(timeIntervalSinceNow: 3_600),
            lastError: nil
        )
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await store.connectForeground()
        await store.connectForeground()

        XCTAssertEqual(realtime.startCount, 1)
        XCTAssertEqual(realtime.lastSessionToken, "session-token")
    }

    func testConcurrentConnectForegroundCallsStartRealtimeOnce() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date(timeIntervalSinceNow: 3_600),
            lastError: nil
        )
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await store.connectForeground()
            }
            group.addTask {
                await store.connectForeground()
            }
        }

        XCTAssertEqual(realtime.startCount, 1)
        XCTAssertEqual(store.connectionState, .connected)
    }

    func testConnectForegroundWaitsForTransportStateBeforeConnected() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime(autoConnect: false)
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date(timeIntervalSinceNow: 3_600),
            lastError: nil
        )
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await store.connectForeground()

        XCTAssertEqual(store.connectionState, .connecting)

        realtime.emit(.connected)

        XCTAssertEqual(store.connectionState, .connected)
    }

    func testReconnectForegroundRestartsAnExistingConnection() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date(timeIntervalSinceNow: 3_600),
            lastError: nil
        )
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await store.connectForeground()
        realtime.emit(.reconnecting)
        await store.connectForeground()

        XCTAssertEqual(realtime.startCount, 1)
        XCTAssertEqual(store.connectionState, .reconnecting)

        await store.reconnectForeground()

        XCTAssertEqual(realtime.stopCount, 1)
        XCTAssertEqual(realtime.startCount, 2)
        XCTAssertEqual(store.connectionState, .connected)
    }

    func testRequestScopedRealtimeErrorDoesNotMarkConnectionFailed() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date(timeIntervalSinceNow: 3_600),
            lastError: nil
        )
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await store.connectForeground()
        realtime.emitMessage(.realtimeError(.init(
            type: "realtime_error",
            requestId: "request-1",
            error: "command_failed"
        )))

        XCTAssertEqual(store.connectionState, .connected)
        XCTAssertEqual(store.errorMessage, "command_failed")
    }

    func testConnectForegroundMovesToSignedOutWhenSessionRefreshFails() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let realtime = FakeOpenClawRealtime()
        AppSessionManager.shared.resetForUITesting()
        let store = OpenClawStore(
            api: FakeOpenClawAPI(),
            realtime: realtime,
            appSessionManager: .shared,
            defaults: defaults
        )

        await store.connectForeground()

        XCTAssertEqual(realtime.startCount, 0)
        XCTAssertEqual(store.connectionState, .signedOut)
    }
}

private actor FakeOpenClawAPI: OpenClawAPIClient {
    func fetchPreferences(sessionToken _: String) async throws -> String { "Maude" }
    func updatePreferences(displayName: String, sessionToken _: String) async throws -> String { displayName }
    func fetchThreads(sessionToken _: String) async throws -> [OpenClawThread] { [] }
    func fetchMessages(threadId _: String, sessionToken _: String) async throws -> [OpenClawMessageWithActions] { [] }
}

private final class FakeOpenClawRealtime: OpenClawRealtimeConnecting {
    private let autoConnect: Bool
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var lastSessionToken: String?
    private(set) var lastSeenSequence: Int64?
    private var onConnectionStateChange: (@MainActor (OpenClawRealtimeTransportState) -> Void)?
    private var onMessage: (@MainActor (OpenClawServerMessage) -> Void)?

    init(autoConnect: Bool = true) {
        self.autoConnect = autoConnect
    }

    func start(
        sessionToken: String,
        lastSeenSequence: Int64?,
        onConnectionStateChange: @escaping @MainActor (OpenClawRealtimeTransportState) -> Void,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    ) {
        startCount += 1
        lastSessionToken = sessionToken
        self.lastSeenSequence = lastSeenSequence
        self.onConnectionStateChange = onConnectionStateChange
        self.onMessage = onMessage
        if autoConnect {
            onConnectionStateChange(.connected)
        }
    }

    func stop() {
        stopCount += 1
    }

    private(set) var sentCommands: [OpenClawClientCommand] = []

    func send(_ command: OpenClawClientCommand) async throws {
        sentCommands.append(command)
    }

    func emit(_ state: OpenClawRealtimeTransportState) {
        onConnectionStateChange?(state)
    }

    func emitMessage(_ message: OpenClawServerMessage) {
        onMessage?(message)
    }
}

private enum OpenClawFixtures {
    static let thread = OpenClawThread(
        id: "thread-1",
        sessionKey: "cowtail:thread-1",
        status: .active,
        targetAgent: "default",
        title: "Deploy check",
        unreadCount: 1,
        createdAt: 1777127000000,
        updatedAt: 1777128000000,
        lastMessageAt: 1777128000000
    )

    static let message = OpenClawMessage(
        id: "message-1",
        threadId: "thread-1",
        direction: .openClawToUser,
        authorLabel: "OpenClaw",
        text: "Approve rollout?",
        links: [],
        deliveryState: .sent,
        createdAt: 1777128000000,
        updatedAt: 1777128000000
    )
}
