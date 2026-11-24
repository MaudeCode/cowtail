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
            let sentAuthentication = await api.sentAuthentication
            XCTAssertEqual(asked, 1, "allows=\(allows)")
            XCTAssertEqual(sentAuthentication, allows ? [true] : [], "allows=\(allows)")
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
        let sentAuthentication = await api.sentAuthentication
        XCTAssertEqual(asked, 0)
        XCTAssertEqual(sent.map(\.request), [.approve])
        // The server hears that no Face ID was asked, and refuses it if the owner now needs one.
        XCTAssertEqual(sentAuthentication, [false])
    }

    func testApproveAsksForFaceIDWhenTheServerSaysTheItemNeedsIt() async {
        let guarded = Item(
            id: approval.id,
            source: "hermes",
            kind: .approval,
            urgency: .now,
            needsOwner: true,
            title: approval.title,
            actions: [.approve, .deny],
            approvalNeedsAuth: true,
            createdAt: approval.createdAt
        )
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [guarded], withHermes: [], handled: []))
        let authenticator = FakeAuthenticator(allows: true)
        let store = store(api: api, authenticator: authenticator)
        await store.refresh()

        await store.perform(.approve, on: guarded)

        let asked = await authenticator.requests
        let sentAuthentication = await api.sentAuthentication
        XCTAssertEqual(asked, 1)
        XCTAssertEqual(sentAuthentication, [true])
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

    func testALateRefusalPutsBackOnlyItsOwnItem() async {
        let question = Item(
            id: "question-1",
            source: "hermes",
            kind: .question,
            urgency: .now,
            needsOwner: true,
            title: "Rebalance now?",
            actions: [.reply],
            createdAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval, question], withHermes: [], handled: []))
        let store = store(api: api)
        await store.refresh()
        await api.hold(itemID: approval.id)

        let denial = Task { await store.perform(.deny, on: approval) }
        await api.waitUntilHeld()
        await store.perform(.reply("Wait"), on: question)
        await api.releaseHeld(with: CowtailAPIError.refused("The item is closed"))
        await denial.value

        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [approval.id])
        XCTAssertEqual(store.inbox?.withHermes.map(\.id), [question.id])
        XCTAssertEqual(store.inbox?.counts, ItemInbox.Counts(needsYou: 1, withHermes: 1, handled: 0))
        XCTAssertEqual(store.actionErrors[approval.id], "The item is closed")
    }

    func testASecondTapWhileTheFirstIsOnItsWaySendsNothing() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: [], handled: []))
        let store = store(api: api)
        await store.refresh()
        await api.hold(itemID: approval.id)

        let first = Task { await store.perform(.approve, on: approval) }
        await api.waitUntilHeld()
        await store.perform(.deny, on: approval)
        await api.releaseHeld(with: CowtailAPIError.refused("The item is closed"))
        await first.value

        let attempts = await api.actionAttempts
        XCTAssertEqual(attempts, 1)
    }

    func testAnUnconfirmedWriteStaysShownAndTakesNoSecondAnswerUntilTheServerAnswers() async {
        let api = FakeItemAPI(
            inbox: ItemInbox(needsYou: [approval], withHermes: [], handled: []),
            actionError: URLError(.timedOut)
        )
        let store = store(api: api)
        await store.refresh()
        await api.failInbox(with: URLError(.notConnectedToInternet))

        await store.perform(.approve, on: approval)
        await store.perform(.approve, on: approval)

        let attempts = await api.actionAttempts
        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [])
        XCTAssertEqual(attempts, 1)
    }

    func testHistoryReadsPastPagesTheFiltersEmptied() async {
        let older = Item(
            id: "older",
            source: "cron",
            kind: .approval,
            urgency: .today,
            title: "Older match",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            createdDate: "2023-11-14"
        )
        let api = FakeItemAPI(
            inbox: .empty,
            pagesByCursor: [
                "": ItemPage(items: [], nextCursor: "page-2"),
                "page-2": ItemPage(items: [older], nextCursor: nil, days: [.init(date: "2023-11-14", count: 1)]),
            ]
        )
        let store = store(api: api)

        await store.loadHistory(HistoryFilter(kind: .approval))

        XCTAssertEqual(store.historyItems.map(\.id), ["older"])
    }

    func testAHistoryContinuationKeepsTheFirstPagesDateBounds() async {
        let item = { (id: String) in
            Item(id: id, source: "cron", kind: .fyi, urgency: .today, title: id, createdAt: .now, createdDate: "2026-11-24")
        }
        let api = FakeItemAPI(
            inbox: .empty,
            pagesByCursor: [
                "": ItemPage(items: [item("first")], nextCursor: "page-2"),
                "page-2": ItemPage(items: [item("second")], nextCursor: nil),
            ]
        )
        let store = store(api: api)
        await store.loadHistory(HistoryFilter(range: .day))

        await store.loadMoreHistory()

        let queries = await api.listQueries
        XCTAssertEqual(store.historyItems.map(\.id), ["first", "second"])
        XCTAssertEqual(queries.map(\.cursor), [nil, "page-2"])
        XCTAssertEqual(queries.map(\.from).count, 2)
        XCTAssertEqual(queries.first?.from, queries.last?.from)
    }

    func testRefreshingHistoryKeepsAsManyItemsAsAreShown() async {
        let shown = (0..<120).map {
            Item(id: "item-\($0)", source: "cron", kind: .fyi, urgency: .today, title: "\($0)", createdAt: .now)
        }
        let api = FakeItemAPI(inbox: .empty, pagesByCursor: ["": ItemPage(items: shown, nextCursor: nil)])
        let store = store(api: api)
        await store.loadHistory(HistoryFilter())

        await store.loadHistory(HistoryFilter())

        let limits = await api.listQueries.map(\.limit)
        XCTAssertEqual(limits, [100, 120])
        XCTAssertEqual(store.historyItems.count, 120)
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

/// Answers like the server: the inbox it holds, the owner's actions applied to it, and list
/// pages keyed by the cursor that asks for them.
private actor FakeItemAPI: CowtailAPIClient {
    private var inbox: ItemInbox
    private var inboxError: Error?
    private let actionError: Error?
    private var failingHealthRequests: Int
    private let pagesByCursor: [String: ItemPage]
    private(set) var sentActions: [(itemID: String, request: ItemActionRequest)] = []
    private(set) var actionAttempts = 0
    private(set) var listQueries: [ItemListQuery] = []
    private(set) var sentAuthentication: [Bool?] = []
    private(set) var healthRequests = 0

    /// `pagesByCursor[""]` is the first page.
    init(
        inbox: ItemInbox,
        actionError: Error? = nil,
        failingHealthRequests: Int = 0,
        pagesByCursor: [String: ItemPage] = [:]
    ) {
        self.inbox = inbox
        self.actionError = actionError
        self.failingHealthRequests = failingHealthRequests
        self.pagesByCursor = pagesByCursor
    }

    func failInbox(with error: Error) {
        inboxError = error
    }

    private var heldItemID: String?
    private var heldRequest: CheckedContinuation<Error, Never>?
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []

    /// The next action on this item waits at the server until `releaseHeld`.
    func hold(itemID: String) {
        heldItemID = itemID
    }

    func waitUntilHeld() async {
        if heldRequest != nil {
            return
        }
        await withCheckedContinuation { heldWaiters.append($0) }
    }

    func releaseHeld(with error: Error) {
        heldRequest?.resume(returning: error)
        heldRequest = nil
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
        if let inboxError {
            throw inboxError
        }
        // Totals follow the lists, as the server counts them.
        return ItemInbox(needsYou: inbox.needsYou, withHermes: inbox.withHermes, handled: inbox.handled)
    }

    func fetchItems(_ query: ItemListQuery, sessionToken _: String) async throws -> ItemPage {
        listQueries.append(query)
        guard let page = pagesByCursor[query.cursor ?? ""] else {
            throw CowtailAPIError.refused("Invalid cursor")
        }
        return page
    }

    func fetchItem(id _: String, sessionToken _: String) async throws -> ItemDetail? {
        nil
    }

    func fetchItemStats(_: ItemListQuery, sessionToken _: String) async throws -> ItemStats {
        CowtailPreviewFixtures.stats
    }

    func performItemAction(
        itemID: String,
        request: ItemActionRequest,
        authenticated: Bool?,
        sessionToken _: String
    ) async throws -> Item {
        sentAuthentication.append(authenticated)
        actionAttempts += 1
        if itemID == heldItemID {
            heldItemID = nil
            let error = await withCheckedContinuation { continuation in
                heldRequest = continuation
                heldWaiters.forEach { $0.resume() }
                heldWaiters.removeAll()
            }
            throw error
        }
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

    func performAlertAction(
        alertID _: String,
        action _: AlertHumanAction,
        note _: String?,
        sessionToken _: String
    ) async throws {}

    func fetchItemSources(sessionToken _: String) async throws -> [String] {
        []
    }

    func fetchDevices(sessionToken _: String) async throws -> [UserDevice] {
        []
    }
}
