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
            appSessionManager: .shared,
            defaults: defaults
        )

        XCTAssertEqual(store.displayName, "Maude")
    }

    func testRefreshLoadsPreferencesAndThreads() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date().addingTimeInterval(3600),
            lastError: nil
        )
        let api = FakeOpenClawAPI(displayName: "Maude Ops", threads: [OpenClawFixtures.thread])
        let store = OpenClawStore(api: api, appSessionManager: .shared, defaults: defaults)

        await store.refreshIfPossible()

        XCTAssertFalse(store.isSignedOut)
        XCTAssertEqual(store.displayName, "Maude Ops")
        XCTAssertEqual(defaults.string(forKey: "openclaw.displayName"), "Maude Ops")
        XCTAssertEqual(store.threads.map(\.id), ["thread-1"])
    }

    func testRefreshMarksStoreSignedOutWhenSessionRefreshFails() async {
        AppSessionManager.shared.resetForUITesting()
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(api: FakeOpenClawAPI(), appSessionManager: .shared, defaults: defaults)

        await store.refreshIfPossible()

        XCTAssertTrue(store.isSignedOut)
        XCTAssertTrue(store.threads.isEmpty)
    }

    func testUpdateDisplayNameReportsFailureWhenSessionRefreshFails() async {
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        defaults.set("Maude", forKey: "openclaw.displayName")
        AppSessionManager.shared.resetForUITesting()
        let store = OpenClawStore(api: FakeOpenClawAPI(), appSessionManager: .shared, defaults: defaults)

        let saved = await store.updateDisplayName("Maude Ops")

        XCTAssertFalse(saved)
        XCTAssertTrue(store.isSignedOut)
        XCTAssertEqual(store.displayName, "Maude")
        XCTAssertEqual(defaults.string(forKey: "openclaw.displayName"), "Maude")
        XCTAssertEqual(store.errorMessage, "Sign in from Farmhouse to update OpenClaw settings.")
    }

    func testLoadMessagesReplacesFetchedMessagesInCreatedOrder() async {
        AppSessionManager.shared.seedForUITesting(
            sessionState: .ready,
            token: "session-token",
            userID: "user-1",
            expiresAt: Date().addingTimeInterval(3600),
            lastError: nil
        )
        let older = OpenClawMessageWithActions(message: OpenClawFixtures.message(id: "message-old", createdAt: 1), actions: [])
        let newer = OpenClawMessageWithActions(message: OpenClawFixtures.message(id: "message-new", createdAt: 2), actions: [])
        let api = FakeOpenClawAPI(messagesByThreadID: ["thread-1": [newer, older]])
        let defaults = UserDefaults(suiteName: "OpenClawStoreTests.\(UUID().uuidString)")!
        let store = OpenClawStore(api: api, appSessionManager: .shared, defaults: defaults)

        await store.loadMessages(threadId: "thread-1")

        XCTAssertFalse(store.isSignedOut)
        XCTAssertEqual(store.messagesByThreadID["thread-1"]?.map(\.id), ["message-old", "message-new"])
    }
}

private actor FakeOpenClawAPI: OpenClawAPIClient {
    let displayName: String
    let threads: [OpenClawThread]
    let messagesByThreadID: [String: [OpenClawMessageWithActions]]

    init(
        displayName: String = "Maude",
        threads: [OpenClawThread] = [],
        messagesByThreadID: [String: [OpenClawMessageWithActions]] = [:]
    ) {
        self.displayName = displayName
        self.threads = threads
        self.messagesByThreadID = messagesByThreadID
    }

    func fetchPreferences(sessionToken _: String) async throws -> String {
        displayName
    }

    func updatePreferences(displayName: String, sessionToken _: String) async throws -> String {
        displayName
    }

    func fetchThreads(sessionToken _: String) async throws -> [OpenClawThread] {
        threads
    }

    func fetchMessages(threadId: String, sessionToken _: String) async throws -> [OpenClawMessageWithActions] {
        messagesByThreadID[threadId] ?? []
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

    static func message(id: String = "message-1", createdAt: Int64 = 1777128000000) -> OpenClawMessage {
        OpenClawMessage(
            id: id,
            threadId: "thread-1",
            direction: .openClawToUser,
            authorLabel: "OpenClaw",
            text: "Approve rollout?",
            links: [],
            deliveryState: .sent,
            createdAt: createdAt,
            updatedAt: createdAt
        )
    }
}
