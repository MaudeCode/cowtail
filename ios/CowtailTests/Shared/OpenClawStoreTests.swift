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
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var lastSessionToken: String?
    private(set) var lastSeenSequence: Int64?

    func start(sessionToken: String, lastSeenSequence: Int64?, onMessage _: @escaping @MainActor (OpenClawServerMessage) -> Void) {
        startCount += 1
        lastSessionToken = sessionToken
        self.lastSeenSequence = lastSeenSequence
    }

    func stop() {
        stopCount += 1
    }

    func send(_ command: OpenClawClientCommand) async throws {}
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
