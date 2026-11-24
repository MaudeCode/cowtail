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
    @Published private(set) var alertActionsInFlight: Set<String> = []

    @Published private(set) var historyFilter = HistoryFilter()
    @Published private(set) var historyItems: [Item] = []
    @Published private(set) var historyStats: ItemStats?
    @Published private(set) var historyError: String?
    @Published private(set) var isLoadingHistory = false
    private var historyCursor: String?

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

    init(
        api: any CowtailAPIClient = CowtailAPI(),
        sessionToken: @escaping @MainActor () async -> String? = {
            await AppSessionManager.shared.refreshSessionIfPossible()
        },
        authenticator: any ApprovalAuthenticating = DeviceOwnerAuthenticator(),
        requiresApprovalAuthentication: @escaping @MainActor () -> Bool = {
            NotificationManager.shared.preferences.requireAuthForApprovals
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
            clusterStats = try await api.fetchItemStats(from: nil, to: nil, sessionToken: token)
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
        actionErrors[item.id] = nil
        if request.isApproval, requiresApprovalAuthentication() {
            guard await authenticator.authenticate(reason: "Confirm your answer to “\(item.title)”.") else {
                actionErrors[item.id] = "Approval needs Face ID or your passcode."
                return
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
            let updated = try await api.performItemAction(itemID: item.id, request: request, sessionToken: token)
            if details[item.id] != nil {
                details[item.id]?.item = updated
                await loadDetail(itemID: item.id)
            }
            await reloadInbox(sessionToken: token)
        } catch CowtailAPIError.refused(let message) {
            inbox = inboxBefore
            details[item.id] = detailBefore
            actionErrors[item.id] = message
        } catch {
            // The write may or may not have landed: ask the server before keeping either.
            actionErrors[item.id] = error.localizedDescription
            if !(await reloadInbox(sessionToken: token)) {
                inbox = inboxBefore
            }
            if detailBefore != nil {
                await loadDetail(itemID: item.id)
            }
        }
    }

    private func showOptimistically(_ request: ItemActionRequest, on item: Item) {
        var moved = item
        moved.needsOwner = false
        switch request {
        case .ack: moved.state = .acked
        case .snooze: moved.state = .snoozed
        default: break
        }

        if var current = inbox {
            current.needsYou.removeAll { $0.id == item.id }
            current.withHermes.removeAll { $0.id == item.id }
            if moved.state != .snoozed {
                current.withHermes.insert(moved, at: 0)
            }
            inbox = current
        }
        details[item.id]?.item = moved
    }

    func isPerformingAlertAction(on item: Item) -> Bool {
        alertActionsInFlight.contains(item.id)
    }

    /// Mark noise, escalate or retry: the server decides the result, so the control waits.
    func perform(_ action: AlertHumanAction, on item: Item) async {
        guard let alertID = item.alertID, !alertActionsInFlight.contains(item.id) else { return }
        actionErrors[item.id] = nil
        guard let token = await sessionToken() else {
            actionErrors[item.id] = Self.signInMessage
            return
        }
        alertActionsInFlight.insert(item.id)
        defer { alertActionsInFlight.remove(item.id) }

        do {
            try await api.performAlertAction(alertID: alertID, action: action, sessionToken: token)
            await loadDetail(itemID: item.id)
            await reloadInbox(sessionToken: token)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            actionErrors[item.id] = error.localizedDescription
        }
    }

    // MARK: History

    func loadHistory(_ filter: HistoryFilter) async {
        historyFilter = filter
        guard let token = await sessionToken() else {
            historyError = Self.signInMessage
            return
        }
        isLoadingHistory = true
        defer { isLoadingHistory = false }

        let query = filter.query(now: .now)
        do {
            async let page = api.fetchItems(query, sessionToken: token)
            async let stats = api.fetchItemStats(from: query.from, to: nil, sessionToken: token)
            let (loadedPage, loadedStats) = try await (page, stats)
            guard filter == historyFilter else { return }
            historyItems = loadedPage.items
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
        var query = filter.query(now: .now)
        query.cursor = cursor
        isLoadingHistory = true
        defer { isLoadingHistory = false }
        do {
            let page = try await api.fetchItems(query, sessionToken: token)
            guard filter == historyFilter else { return }
            historyItems += page.items
            historyCursor = page.nextCursor
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            historyError = error.localizedDescription
        }
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
