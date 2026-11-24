import XCTest
@testable import Cowtail

@MainActor
final class CowtailStoreTests: XCTestCase {
    private let approval = Item(
        id: "approval-1",
        source: "hermes",
        kind: .approval,
        urgency: .now,
        needsOwner: true,
        title: "Restart ingress in edge?",
        actions: [.approve, .deny],
        createdAt: Date(timeIntervalSince1970: 1_800_000_000)
    )

    private func store(
        api: FakeItemAPI,
        authenticator: FakeAuthenticator = FakeAuthenticator(allows: true),
        requiresAuthentication: Bool = false
    ) -> CowtailStore {
        CowtailStore(
            api: api,
            sessionToken: { "session-token" },
            authenticator: authenticator,
            requiresApprovalAuthentication: { requiresAuthentication }
        )
    }

    func testApproveWaitsForLocalAuthenticationWhenTheOwnerRequiresIt() async {
        for allows in [false, true] {
            let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: [], handled: []))
            let authenticator = FakeAuthenticator(allows: allows)
            let store = store(api: api, authenticator: authenticator, requiresAuthentication: true)
            await store.refresh()

            await store.perform(.approve, on: approval)

            let sent = await api.sentActions
            let asked = await authenticator.requests
            XCTAssertEqual(asked, 1, "allows=\(allows)")
            XCTAssertEqual(sent.map(\.request), allows ? [.approve] : [], "allows=\(allows)")
            XCTAssertEqual(store.inbox?.needsYou.map(\.id), allows ? [] : [approval.id], "allows=\(allows)")
            XCTAssertEqual(store.actionErrors[approval.id] != nil, !allows, "allows=\(allows)")
        }
    }

    func testApproveSkipsLocalAuthenticationWhenTheOwnerDoesNotRequireIt() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: [], handled: []))
        let authenticator = FakeAuthenticator(allows: false)
        let store = store(api: api, authenticator: authenticator)
        await store.refresh()

        await store.perform(.approve, on: approval)

        let sent = await api.sentActions
        let asked = await authenticator.requests
        XCTAssertEqual(asked, 0)
        XCTAssertEqual(sent.map(\.request), [.approve])
    }

    func testARefusedActionRollsTheInboxBackAndShowsTheServersError() async {
        let api = FakeItemAPI(
            inbox: ItemInbox(needsYou: [approval], withHermes: [], handled: []),
            actionError: CowtailAPIError.refused("The item is closed")
        )
        let store = store(api: api)
        await store.refresh()

        await store.perform(.deny, on: approval)

        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [approval.id])
        XCTAssertEqual(store.inbox?.withHermes, [])
        XCTAssertEqual(store.actionErrors[approval.id], "The item is closed")
    }

    func testRefreshRetriesHealthAfterTransientFailure() async {
        let api = FakeItemAPI(inbox: .empty, failingHealthRequests: 1)
        let store = store(api: api)

        await store.refresh()

        let healthRequests = await api.healthRequests
        XCTAssertEqual(store.health, CowtailPreviewFixtures.health)
        XCTAssertNil(store.healthErrorMessage)
        XCTAssertEqual(healthRequests, 2)
    }
}

private actor FakeAuthenticator: ApprovalAuthenticating {
    let allows: Bool
    private(set) var requests = 0

    init(allows: Bool) {
        self.allows = allows
    }

    func authenticate(reason _: String) async -> Bool {
        requests += 1
        return allows
    }
}

/// Answers like the server: the inbox it holds, and the owner's actions applied to it.
private actor FakeItemAPI: CowtailAPIClient {
    private var inbox: ItemInbox
    private let actionError: Error?
    private var failingHealthRequests: Int
    private(set) var sentActions: [(itemID: String, request: ItemActionRequest)] = []
    private(set) var healthRequests = 0

    init(inbox: ItemInbox, actionError: Error? = nil, failingHealthRequests: Int = 0) {
        self.inbox = inbox
        self.actionError = actionError
        self.failingHealthRequests = failingHealthRequests
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        healthRequests += 1
        if failingHealthRequests > 0 {
            failingHealthRequests -= 1
            throw URLError(.networkConnectionLost)
        }
        return CowtailPreviewFixtures.health
    }

    func fetchInbox(sessionToken _: String) async throws -> ItemInbox {
        inbox
    }

    func fetchItems(_: ItemListQuery, sessionToken _: String) async throws -> ItemPage {
        ItemPage(items: [], nextCursor: nil)
    }

    func fetchItem(id _: String, sessionToken _: String) async throws -> ItemDetail? {
        nil
    }

    func fetchItemStats(from _: Date?, to _: Date?, sessionToken _: String) async throws -> ItemStats {
        CowtailPreviewFixtures.stats
    }

    func performItemAction(itemID: String, request: ItemActionRequest, sessionToken _: String) async throws -> Item {
        if let actionError {
            throw actionError
        }
        sentActions.append((itemID, request))
        guard var item = inbox.item(withID: itemID) else { throw CowtailAPIError.refused("Item not found") }
        item.needsOwner = false
        inbox.needsYou.removeAll { $0.id == itemID }
        inbox.withHermes.insert(item, at: 0)
        return item
    }

    func performAlertAction(alertID _: String, action _: AlertHumanAction, sessionToken _: String) async throws {}

    func fetchDevices(sessionToken _: String) async throws -> [UserDevice] {
        []
    }
}
