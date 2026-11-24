import Foundation
import OSLog

private let healthRefreshRetryDelays: [Duration] = [
    .milliseconds(500),
    .milliseconds(1_000),
]

private func fetchHealthSummaryWithRetry(
    from api: any CowtailAPIClient
) async throws -> HealthSummary {
    do {
        return try await api.fetchHealthSummary()
    } catch {
        guard !NetworkErrorClassifier.isCancellation(error) else {
            throw error
        }

        var lastError = error

        for delay in healthRefreshRetryDelays {
            try await Task.sleep(for: delay)

            do {
                return try await api.fetchHealthSummary()
            } catch {
                guard !NetworkErrorClassifier.isCancellation(error) else {
                    throw error
                }

                lastError = error
            }
        }

        throw lastError
    }
}

/// The History tab's filter. Everything but `search` shows as a removable chip.
struct HistoryFilter: Hashable, Sendable {
    enum Range: Int, CaseIterable, Identifiable, Sendable {
        case day = 1
        case week = 7
        case month = 30
        case quarter = 90

        var id: Int { rawValue }
    }

    var source: String?
    var kind: ItemKind?
    var outcome: ItemOutcome?
    var range: Range?
    var search = ""

    func query(now: Date) -> ItemListQuery {
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return ItemListQuery(
            source: source,
            kind: kind,
            outcome: outcome,
            search: trimmed.isEmpty ? nil : trimmed,
            from: range.map { now.addingTimeInterval(-Double($0.rawValue) * 86_400) }
        )
    }
}

@MainActor
final class CowtailStore: ObservableObject {
    @Published private(set) var inbox: ItemInbox?
    @Published private(set) var health: HealthSummary?
    @Published private(set) var healthErrorMessage: String?
    @Published private(set) var clusterStats: ItemStats?
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    @Published private(set) var details: [String: ItemDetail] = [:]
    @Published private(set) var detailErrors: [String: String] = [:]
    @Published private(set) var itemIDsByAlertID: [String: String] = [:]
    @Published private(set) var actionErrors: [String: String] = [:]
    /// Writes whose outcome the server has not confirmed yet; their items take no new action.
    @Published private(set) var unconfirmedItemIDs: Set<String> = []
    /// Items with a write on its way; a second tap waits for the first to settle.
    private var itemIDsInFlight: Set<String> = []
    @Published private(set) var alertActionsInFlight: Set<String> = []

    @Published private(set) var historyFilter = HistoryFilter()
    @Published private(set) var historyItems: [Item] = []
    @Published private(set) var historyDayCounts: [String: Int] = [:]
    @Published private(set) var historyStats: ItemStats?
    @Published private(set) var historySources: [String] = []
    @Published private(set) var historyError: String?
    @Published private(set) var isLoadingHistory = false
    private var historyCursor: String?
    /// The query the current history pages came from; continuations reuse its bounds.
    private var historyQuery: ItemListQuery?

    @Published private(set) var devices: [UserDevice] = []

    private let api: any CowtailAPIClient
    private let sessionToken: @MainActor () async -> String?
    private let authenticator: any ApprovalAuthenticating
    private let requiresApprovalAuthentication: @MainActor () -> Bool
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "store"
    )

    static let signInMessage = "Sign in with Apple in Settings to load your items."
    static let unconfirmedMessage = "Cowtail has not confirmed your last answer yet. Pull to refresh."

    init(
        api: any CowtailAPIClient = CowtailAPI(),
        sessionToken: @escaping @MainActor () async -> String? = {
            await AppSessionManager.shared.refreshSessionIfPossible()
        },
        authenticator: any ApprovalAuthenticating = DeviceOwnerAuthenticator(),
        requiresApprovalAuthentication: @escaping @MainActor () -> Bool = {
            NotificationManager.shared.requiresApprovalAuthentication
        }
    ) {
        self.api = api
        self.sessionToken = sessionToken
        self.authenticator = authenticator
        self.requiresApprovalAuthentication = requiresApprovalAuthentication
    }

    // MARK: Inbox and cluster

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        async let health: Void = refreshHealth()
        let token = await sessionToken()
        if let token {
            async let stats: Void = refreshClusterStats(sessionToken: token)
            if await reloadInbox(sessionToken: token) {
                errorMessage = nil
            }
            await stats
        } else {
            errorMessage = Self.signInMessage
        }
        await health
        lastUpdated = .now
    }

    private func refreshHealth() async {
        do {
            health = try await fetchHealthSummaryWithRetry(from: api)
            healthErrorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh health failed: \(String(describing: error), privacy: .public)")
            healthErrorMessage = error.localizedDescription
        }
    }

    private func refreshClusterStats(sessionToken token: String) async {
        do {
            clusterStats = try await api.fetchItemStats(ItemListQuery(), sessionToken: token)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh stats failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// True when the server answered.
    @discardableResult
    private func reloadInbox(sessionToken token: String) async -> Bool {
        do {
            inbox = try await api.fetchInbox(sessionToken: token)
            unconfirmedItemIDs.removeAll()
            return true
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return false }
            logger.error("refresh inbox failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
            return false
        }
    }

    // MARK: Item detail

    func loadDetail(itemID: String) async {
        guard let token = await sessionToken() else {
            detailErrors[itemID] = Self.signInMessage
            return
        }
        do {
            if let detail = try await api.fetchItem(id: itemID, sessionToken: token) {
                details[itemID] = detail
                detailErrors[itemID] = nil
            } else {
                detailErrors[itemID] = "This item could not be found."
            }
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            detailErrors[itemID] = error.localizedDescription
        }
    }

    /// An alert link opens the item the server keeps for that alert.
    func loadDetail(alertID: String) async {
        guard let token = await sessionToken() else {
            detailErrors[alertID] = Self.signInMessage
            return
        }
        do {
            let page = try await api.fetchItems(ItemListQuery(alertID: alertID), sessionToken: token)
            guard let item = page.items.first else {
                detailErrors[alertID] = "This alert could not be found."
                return
            }
            itemIDsByAlertID[alertID] = item.id
            await loadDetail(itemID: item.id)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            detailErrors[alertID] = error.localizedDescription
        }
    }

    // MARK: Owner actions

    /// Shows the action's result at once, then keeps it or rolls it back on the server's word.
    func perform(_ request: ItemActionRequest, on item: Item) async {
        guard !unconfirmedItemIDs.contains(item.id) else {
            actionErrors[item.id] = Self.unconfirmedMessage
            return
        }
        // Held from before the first suspension, so a second tap cannot overtake this write.
        guard itemIDsInFlight.insert(item.id).inserted else { return }
        defer { itemIDsInFlight.remove(item.id) }
        actionErrors[item.id] = nil
        // The server's word on the item and this device's setting both count; the server
        // refuses an approval sent without Face ID while the owner requires it.
        var authenticated: Bool?
        if request.isApproval {
            if item.approvalNeedsAuth || requiresApprovalAuthentication() {
                guard await authenticator.authenticate(reason: "Confirm your answer to “\(item.title)”.") else {
                    actionErrors[item.id] = "Approval needs Face ID or your passcode."
                    return
                }
                authenticated = true
            } else {
                authenticated = false
            }
        }
        guard let token = await sessionToken() else {
            actionErrors[item.id] = Self.signInMessage
            return
        }

        let inboxBefore = inbox
        let detailBefore = details[item.id]
        showOptimistically(request, on: item)

        do {
            let updated = try await api.performItemAction(
                itemID: item.id,
                request: request,
                authenticated: authenticated,
                sessionToken: token
            )
            if details[item.id] != nil {
                details[item.id]?.item = updated
                await loadDetail(itemID: item.id)
            }
            await reloadInbox(sessionToken: token)
        } catch CowtailAPIError.refused(let message) {
            restore(item.id, from: inboxBefore)
            details[item.id] = detailBefore
            actionErrors[item.id] = message
        } catch {
            // The write may or may not have landed. Keep showing it, and take no new action on
            // the item, until a read from the server says which.
            unconfirmedItemIDs.insert(item.id)
            actionErrors[item.id] = error.localizedDescription
            if await reloadInbox(sessionToken: token) {
                actionErrors[item.id] = nil
            } else {
                actionErrors[item.id] = Self.unconfirmedMessage
            }
            if detailBefore != nil {
                await loadDetail(itemID: item.id)
            }
        }
    }

    /// Changes the shown lists for the owner's own write, moving the server's totals with them.
    private func adjustInbox(_ change: (inout ItemInbox) -> Void) {
        guard var current = inbox else { return }
        let before = current
        change(&current)
        current.counts.needsYou += current.needsYou.count - before.needsYou.count
        current.counts.withHermes += current.withHermes.count - before.withHermes.count
        current.counts.handled += current.handled.count - before.handled.count
        inbox = current
    }

    /// Puts one refused item back where it was, leaving every other item as it is now.
    private func restore(_ itemID: String, from before: ItemInbox?) {
        guard let before else { return }
        adjustInbox { current in
        current.needsYou.removeAll { $0.id == itemID }
        current.withHermes.removeAll { $0.id == itemID }
        current.handled.removeAll { $0.id == itemID }
        func putBack(_ section: WritableKeyPath<ItemInbox, [Item]>) {
            guard let index = before[keyPath: section].firstIndex(where: { $0.id == itemID }) else { return }
            current[keyPath: section].insert(before[keyPath: section][index], at: min(index, current[keyPath: section].count))
        }
            putBack(\.needsYou)
            putBack(\.withHermes)
            putBack(\.handled)
        }
    }

    private func showOptimistically(_ request: ItemActionRequest, on item: Item) {
        var moved = item
        moved.needsOwner = false
        if request.isAnswer {
            moved.availableActions.removeAll(where: \.isAnswer)
        }
        switch request {
        case .ack: moved.state = .acked
        case .snooze: moved.state = .snoozed
        default: break
        }

        adjustInbox { current in
            current.needsYou.removeAll { $0.id == item.id }
            current.withHermes.removeAll { $0.id == item.id }
            if moved.state != .snoozed {
                current.withHermes.insert(moved, at: 0)
            }
        }
        details[item.id]?.item = moved
    }

    /// Face ID or the passcode, for a change that weakens approval protection.
    func confirmOwner(reason: String) async -> Bool {
        await authenticator.authenticate(reason: reason)
    }

    func isPerformingAlertAction(on item: Item) -> Bool {
        alertActionsInFlight.contains(item.id)
    }

    /// Mark noise, escalate or retry: the server decides the result, so the control waits.
    func perform(_ action: AlertHumanAction, note: String? = nil, on item: Item) async {
        guard let alertID = item.alertID, !alertActionsInFlight.contains(item.id) else { return }
        actionErrors[item.id] = nil
        guard let token = await sessionToken() else {
            actionErrors[item.id] = Self.signInMessage
            return
        }
        alertActionsInFlight.insert(item.id)
        defer { alertActionsInFlight.remove(item.id) }

        do {
            try await api.performAlertAction(alertID: alertID, action: action, note: note, sessionToken: token)
            await loadDetail(itemID: item.id)
            await reloadInbox(sessionToken: token)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            actionErrors[item.id] = error.localizedDescription
        }
    }

    // MARK: History

    /// Loads the first page for a new filter; a refresh of the same filter reloads as many
    /// items as are already shown, so the owner keeps their place.
    func loadHistory(_ filter: HistoryFilter) async {
        let shown = filter == historyFilter && historyQuery != nil ? historyItems.count : 0
        historyFilter = filter
        guard let token = await sessionToken() else {
            historyError = Self.signInMessage
            return
        }
        isLoadingHistory = true
        defer { isLoadingHistory = false }

        var firstPage = filter.query(now: .now)
        firstPage.limit = min(500, max(firstPage.limit, shown))
        let query = firstPage
        do {
            async let page = fetchHistoryPage(query, sessionToken: token)
            async let stats = api.fetchItemStats(query, sessionToken: token)
            async let sources = api.fetchItemSources(sessionToken: token)
            let (loadedPage, loadedStats, loadedSources) = try await (page, stats, sources)
            guard filter == historyFilter else { return }
            historySources = loadedSources
            historyQuery = query
            historyItems = loadedPage.items
            historyDayCounts = Self.dayCounts(loadedPage.days)
            historyCursor = loadedPage.nextCursor
            historyStats = loadedStats
            historyError = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            historyError = error.localizedDescription
        }
    }

    var hasMoreHistory: Bool { historyCursor != nil }

    func loadMoreHistory() async {
        guard let cursor = historyCursor, !isLoadingHistory, let token = await sessionToken() else { return }
        let filter = historyFilter
        guard var query = historyQuery else { return }
        query.cursor = cursor
        isLoadingHistory = true
        defer { isLoadingHistory = false }
        do {
            let page = try await fetchHistoryPage(query, sessionToken: token)
            guard filter == historyFilter else { return }
            historyItems += page.items
            historyDayCounts.merge(Self.dayCounts(page.days)) { _, newer in newer }
            historyCursor = page.nextCursor
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            historyError = error.localizedDescription
        }
    }

    /// The server filters after it pages, so a page can hold no match yet still continue:
    /// read on until one matches or the list ends.
    /// ponytail: at most 10 pages per call; the Load older button continues past that.
    private func fetchHistoryPage(_ query: ItemListQuery, sessionToken token: String) async throws -> ItemPage {
        var query = query
        var page = try await api.fetchItems(query, sessionToken: token)
        var pages = 1
        while page.items.isEmpty, let cursor = page.nextCursor, pages < 10 {
            query.cursor = cursor
            page = try await api.fetchItems(query, sessionToken: token)
            pages += 1
        }
        return page
    }

    private static func dayCounts(_ days: [ItemPage.Day]) -> [String: Int] {
        Dictionary(days.map { ($0.date, $0.count) }, uniquingKeysWith: { _, newer in newer })
    }

    // MARK: Devices

    func loadDevices() async {
        guard let token = await sessionToken() else { return }
        do {
            devices = try await api.fetchDevices(sessionToken: token)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("load devices failed: \(String(describing: error), privacy: .public)")
        }
    }
}
