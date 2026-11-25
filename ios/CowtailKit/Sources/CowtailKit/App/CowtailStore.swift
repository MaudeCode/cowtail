import Foundation
import Observation
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
    /// A window ending now, in the protocol's values; the server measures it on its own clock.
    enum Range: String, CaseIterable, Identifiable, Sendable {
        case day = "24h"
        case week = "7d"
        case month = "30d"
        case quarter = "90d"

        var id: String { rawValue }
    }

    var source: String?
    var kind: ItemKind?
    var outcome: ItemOutcome?
    /// History opens on the last 24 hours; nil is all time.
    var range: Range? = .day
    var search = ""

    func query() -> ItemListQuery {
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return ItemListQuery(
            source: source,
            kind: kind,
            outcome: outcome,
            search: trimmed.isEmpty ? nil : trimmed,
            range: range
        )
    }
}

/// One ended action: each is new, so the same outcome twice plays twice.
struct ActionFeedback: Equatable {
    let id = UUID()
    let succeeded: Bool
}

struct InboxSnapshot: Codable {
    let inbox: ItemInbox
    let receivedAt: Date
}

@MainActor
@Observable
final class CowtailStore {
    enum InboxState: Equatable {
        case loading
        case fresh
        case stale(Date, String)
        case failed(String)
    }

    private(set) var inbox: ItemInbox?
    private var inboxReceivedAt: Date?
    private var inboxLoadError: String?
    private var hasLoadedInbox = false
    private var hasStartedInboxRequest = false
    private var inboxGeneration = 0

    var inboxState: InboxState {
        if let inboxLoadError {
            if let inboxReceivedAt {
                return .stale(inboxReceivedAt, inboxLoadError)
            }
            return .failed(inboxLoadError)
        }
        return hasLoadedInbox ? .fresh : .loading
    }
    private(set) var health: HealthSummary?
    private(set) var healthErrorMessage: String?
    private(set) var clusterStats: ItemStats?
    private(set) var hermes: HermesStatus?
    private(set) var hermesErrorMessage: String?
    private(set) var lastUpdated: Date?
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    private(set) var details: [String: ItemDetail] = [:]
    private(set) var detailReceivedAt: [String: Date] = [:]
    private(set) var detailErrors: [String: String] = [:]
    /// Each item's metric graph at the range last asked for; absent when the server has none.
    private(set) var graphs: [String: ItemGraph] = [:]
    private(set) var itemIDsByAlertID: [String: String] = [:]
    private(set) var actionErrors: [String: String] = [:]
    /// How the owner's last item action ended, for the haptic the app plays.
    private(set) var actionFeedback: ActionFeedback?
    /// Writes whose outcome the server has not confirmed yet; their items take no new action.
    private(set) var unconfirmedItemIDs: Set<String> = []
    /// Items with a write on its way; a second tap waits for the first to settle.
    private var itemIDsInFlight: Set<String> = []
    /// Snoozes and unsnoozes sent and not yet answered, oldest first. Every inbox read shows
    /// them still applied, so a poll cannot pull an item back before the server answers.
    private var pendingSnoozes: [PendingSnooze] = []
    private struct PendingSnooze {
        let id = UUID()
        let itemID: String
        let request: ItemActionRequest
    }
    private(set) var alertActionsInFlight: Set<String> = []
    /// Each item with an action sent and not yet answered, as the action shows it. Every read of
    /// History or an incident shows it over the server's copy, so a poll cannot undo it.
    private var itemsInFlight: [String: Item] = [:]

    /// The running maintenance windows, the soonest end first.
    private(set) var maintenanceWindows: [MaintenanceWindow] = []
    private(set) var maintenanceError: String?
    /// The sources a new window can hold back, as the server lists them.
    private(set) var maintenanceSourceChoices: [String] = []
    /// Windows the owner ended that the server has not answered for; every read keeps them gone.
    private var endingWindowIDs: Set<String> = []

    let history = HistoryState()

    private(set) var devices: [UserDevice] = []

    private(set) var incidents: [String: IncidentDetail] = [:]
    private(set) var incidentErrors: [String: String] = [:]
    /// The change at the server for each incident; the next one waits for it to settle.
    private(set) var incidentChangesInFlight: [String: IncidentChange] = [:]
    /// Changes sent or waiting their turn, oldest first; every read shows them still applied.
    private var pendingIncidentChanges: [String: [PendingIncidentChange]] = [:]
    private struct PendingIncidentChange {
        let id = UUID()
        let change: IncidentChange
        /// Sent, and its reply lost: shown until a read from the server says whether it landed.
        var unconfirmed = false
    }
    /// What the server last said about each incident.
    private var confirmedIncidents: [String: IncidentDetail] = [:]
    /// Bumped each time a write to the incident settles, so a read taken before is discarded.
    private var incidentWriteGenerations: [String: Int] = [:]
    /// The last change sent or queued for each incident; the next one waits for it.
    private var incidentChangeQueues: [String: Task<Void, Never>] = [:]

    let runbook = RunbookState()

    private let inboxCacheURL: URL?
    private let api: any CowtailAPIClient
    private let sessionToken: @MainActor () async -> String?
    private let sessionFailure: @MainActor () -> String?
    private let authenticator: any ApprovalAuthenticating
    private let requiresApprovalAuthentication: @MainActor () -> Bool
    private let notificationCenter: any DeliveredNotificationCenter
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "store"
    )

    static let signInMessage = "Sign in again to load your items."
    static let unconfirmedMessage = "Cowtail has not confirmed your last answer yet. Pull to refresh."

    init(
        api: any CowtailAPIClient = CowtailAPI(),
        inboxCacheURL: URL? = nil,
        sessionToken: @escaping @MainActor () async -> String? = {
            await AppSessionManager.shared.refreshSessionIfPossible()
        },
        sessionFailure: @escaping @MainActor () -> String? = { AppSessionManager.shared.lastError },
        authenticator: any ApprovalAuthenticating = DeviceOwnerAuthenticator(),
        requiresApprovalAuthentication: @escaping @MainActor () -> Bool = {
            NotificationManager.shared.requiresApprovalAuthentication
        },
        notificationCenter: any DeliveredNotificationCenter = SystemNotificationCenter()
    ) {
        self.inboxCacheURL = inboxCacheURL
        if let inboxCacheURL,
           let data = try? Data(contentsOf: inboxCacheURL),
           let snapshot = try? JSONDecoder().decode(InboxSnapshot.self, from: data) {
            inbox = snapshot.inbox
            inboxReceivedAt = snapshot.receivedAt
        }
        self.api = api
        self.sessionToken = sessionToken
        self.sessionFailure = sessionFailure
        self.authenticator = authenticator
        self.requiresApprovalAuthentication = requiresApprovalAuthentication
        self.notificationCenter = notificationCenter
    }

    func discardInbox() {
        inboxGeneration += 1
        inbox = nil
        inboxReceivedAt = nil
        inboxLoadError = nil
        hasLoadedInbox = false
        hasStartedInboxRequest = false
        errorMessage = nil
        if let inboxCacheURL {
            try? FileManager.default.removeItem(at: inboxCacheURL)
        }
    }

    // MARK: Inbox and cluster

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        async let health: Void = refreshHealth()
        let token = await sessionToken()
        if let token {
            async let stats: Void = refreshClusterStats(sessionToken: token)
            async let hermes: Void = refreshHermes(sessionToken: token)
            async let maintenance: Void = refreshMaintenance(sessionToken: token)
            if await reloadInbox(sessionToken: token) {
                errorMessage = nil
            }
            await stats
            await hermes
            await maintenance
        } else {
            let message = sessionFailure().map { "Could not renew your session. \($0)" } ?? Self.signInMessage
            inboxLoadError = message
            errorMessage = message
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

    private func refreshHermes(sessionToken token: String) async {
        do {
            hermes = try await api.fetchHermesStatus(sessionToken: token)
            hermesErrorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh Hermes failed: \(String(describing: error), privacy: .public)")
            hermesErrorMessage = error.localizedDescription
        }
    }

    private func refreshMaintenance(sessionToken token: String) async {
        do {
            let read = try await api.fetchMaintenanceWindows(sessionToken: token)
            maintenanceWindows = read.active.filter { !endingWindowIDs.contains($0.id) }
            maintenanceSourceChoices = read.sourceChoices
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh maintenance failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: Maintenance windows

    /// Starts a window now. The server silences Alertmanager and decides the window, so the
    /// sheet waits for it. Nil once it started, otherwise why not. The request's id makes a
    /// retry after a lost reply return the same window.
    func startMaintenance(_ request: MaintenanceWindowRequest) async -> String? {
        guard let token = await sessionToken() else { return Self.signInMessage }
        do {
            let window = try await api.startMaintenanceWindow(request, sessionToken: token)
            showWindow(window)
            return nil
        } catch CowtailAPIError.refused(let message) {
            return message
        } catch {
            // The window may have started; the banners show what the server holds.
            await refreshMaintenance(sessionToken: token)
            return error.localizedDescription
        }
    }

    /// Ends a window: its banner goes at once and comes back if the server refuses. When the
    /// reply is lost, a read from the server says whether it ended.
    func endMaintenance(_ window: MaintenanceWindow) async {
        guard let token = await sessionToken() else {
            maintenanceError = Self.signInMessage
            return
        }
        maintenanceError = nil
        endingWindowIDs.insert(window.id)
        maintenanceWindows.removeAll { $0.id == window.id }
        do {
            _ = try await api.endMaintenanceWindow(id: window.id, sessionToken: token)
            endingWindowIDs.remove(window.id)
        } catch CowtailAPIError.refused(let message) {
            endingWindowIDs.remove(window.id)
            showWindow(window)
            maintenanceError = message
        } catch {
            endingWindowIDs.remove(window.id)
            maintenanceError = error.localizedDescription
            await refreshMaintenance(sessionToken: token)
        }
    }

    private func showWindow(_ window: MaintenanceWindow) {
        maintenanceWindows = (maintenanceWindows.filter { $0.id != window.id } + [window])
            .sorted { $0.endsAt < $1.endsAt }
    }

    private func fetchInbox(sessionToken token: String) async throws -> ItemInbox {
        let isFirstRequest = !hasStartedInboxRequest
        hasStartedInboxRequest = true
        do {
            return try await api.fetchInbox(sessionToken: token)
        } catch where isFirstRequest && NetworkErrorClassifier.isTransientConnectionFailure(error) {
            try Task.checkCancellation()
            return try await api.fetchInbox(sessionToken: token)
        }
    }

    /// True when the server answered.
    @discardableResult
    private func reloadInbox(sessionToken token: String) async -> Bool {
        let generation = inboxGeneration
        do {
            let read = try await fetchInbox(sessionToken: token)
            guard generation == inboxGeneration, !Task.isCancelled else { return false }
            inbox = pendingSnoozes.reduce(read) { shown, pending in
                shown.showingPending(pending.request, on: pending.itemID)
            }
            let receivedAt = Date.now
            inboxReceivedAt = receivedAt
            hasLoadedInbox = true
            inboxLoadError = nil
            if let inboxCacheURL {
                do {
                    let data = try JSONEncoder().encode(InboxSnapshot(inbox: read, receivedAt: receivedAt))
                    try data.write(to: inboxCacheURL, options: [.atomic, .completeFileProtection])
                } catch {
                    logger.error("persist inbox failed: \(error.localizedDescription, privacy: .public)")
                }
            }
            unconfirmedItemIDs.removeAll()
            await DeliveredNotifications.show(badge: read.badge, liveItemIDs: read.liveItemIDs, in: notificationCenter)
            return true
        } catch {
            guard generation == inboxGeneration, !NetworkErrorClassifier.isCancellation(error) else { return false }
            inboxLoadError = error.localizedDescription
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
                detailReceivedAt[itemID] = .now
                detailErrors[itemID] = nil
            } else {
                detailErrors[itemID] = "This item could not be found."
            }
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            detailErrors[itemID] = error.localizedDescription
        }
    }

    /// A failed read keeps the graph already shown.
    func loadGraph(itemID: String, range: ItemGraphRange) async {
        guard let token = await sessionToken() else { return }
        do {
            graphs[itemID] = try await api.fetchItemGraph(itemID: itemID, range: range, sessionToken: token)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("Graph load failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// An alert link opens the item the server keeps for that alert.
    func loadDetail(alertID: String) async {
        let errorKey = itemIDsByAlertID[alertID] ?? alertID
        guard let token = await sessionToken() else {
            detailErrors[errorKey] = Self.signInMessage
            return
        }
        do {
            let page = try await api.fetchItems(ItemListQuery(alertID: alertID), sessionToken: token)
            guard let item = page.items.first else {
                detailErrors[errorKey] = "This alert could not be found."
                return
            }
            itemIDsByAlertID[alertID] = item.id
            await loadDetail(itemID: item.id)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            detailErrors[errorKey] = error.localizedDescription
        }
    }

    // MARK: Incidents

    func loadIncident(id: String) async {
        guard let token = await sessionToken() else {
            incidentErrors[id] = Self.signInMessage
            return
        }
        // A read taken before a write settled is older than what the write showed.
        let generation = incidentWriteGenerations[id, default: 0]
        do {
            let read = try await api.fetchIncident(id: id, sessionToken: token)
            guard generation == incidentWriteGenerations[id, default: 0] else { return }
            if let detail = read {
                // The read says whether each change whose reply was lost landed.
                pendingIncidentChanges[id]?.removeAll(where: \.unconfirmed)
                confirm(overlaid(detail), incidentID: id)
                incidentErrors[id] = nil
            } else {
                incidentErrors[id] = "This incident could not be found."
            }
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            incidentErrors[id] = error.localizedDescription
        }
    }

    /// Shows what the server confirmed with every change still on its way applied, so a read
    /// cannot undo a change before the server answers it.
    private func confirm(_ detail: IncidentDetail?, incidentID id: String) {
        if let detail {
            confirmedIncidents[id] = detail
        }
        incidents[id] = (pendingIncidentChanges[id] ?? []).reduce(confirmedIncidents[id]) { shown, pending in
            shown?.showing(pending.change)
        }
    }

    /// Only an add waits on the server for its result, so only Add an item shows busy.
    func isAddingItem(to incidentID: String) -> Bool {
        if case .add = incidentChangesInFlight[incidentID] {
            true
        } else {
            false
        }
    }

    /// The items the server says the owner can add to the incident.
    func incidentCandidates(id: String) async throws -> [Item] {
        guard let token = await sessionToken() else {
            throw CowtailAPIError.requestFailed(Self.signInMessage)
        }
        return try await api.fetchIncidentCandidates(id: id, sessionToken: token)
    }

    /// Every change shows at once and waits for the one before it to settle, so changes reach
    /// the server in the order the owner made them. A refusal puts back what the server last
    /// confirmed, with the later changes still shown. A change whose reply was lost stays shown
    /// until a read from the server says whether it landed.
    func change(_ change: IncidentChange, incidentID id: String) async {
        incidentErrors[id] = nil
        guard let token = await sessionToken() else {
            incidentErrors[id] = Self.signInMessage
            return
        }
        let pending = PendingIncidentChange(change: change)
        pendingIncidentChanges[id, default: []].append(pending)
        confirm(nil, incidentID: id)
        let previous = incidentChangeQueues[id]
        let send = Task {
            await previous?.value
            await self.send(pending, incidentID: id, sessionToken: token)
        }
        incidentChangeQueues[id] = send
        await send.value
    }

    private func send(_ pending: PendingIncidentChange, incidentID id: String, sessionToken token: String) async {
        incidentChangesInFlight[id] = pending.change
        defer { incidentChangesInFlight[id] = nil }
        // Whatever the outcome, a read that started before it is out of date.
        let settle = {
            self.pendingIncidentChanges[id]?.removeAll { $0.id == pending.id }
            self.incidentWriteGenerations[id, default: 0] += 1
        }
        do {
            let reply = try await api.changeIncident(id: id, change: pending.change, sessionToken: token)
            settle()
            confirm(reply, incidentID: id)
            await reloadInbox(sessionToken: token)
        } catch CowtailAPIError.refused(let message) {
            settle()
            confirm(nil, incidentID: id)
            incidentErrors[id] = message
        } catch {
            // The change may or may not have landed: it stays shown until a read says which.
            if let index = pendingIncidentChanges[id]?.firstIndex(where: { $0.id == pending.id }) {
                pendingIncidentChanges[id]?[index].unconfirmed = true
            }
            // Only a read started from here on can say whether it landed.
            incidentWriteGenerations[id, default: 0] += 1
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            incidentErrors[id] = error.localizedDescription
            await loadIncident(id: id)
        }
    }

    // MARK: Owner actions

    /// Shows the action's result at once, then keeps it or rolls it back on the server's word.
    func perform(_ request: ItemActionRequest, on item: Item) async {
        guard !unconfirmedItemIDs.contains(item.id) else {
            actionErrors[item.id] = Self.unconfirmedMessage
            actionFeedback = ActionFeedback(succeeded: false)
            return
        }
        // Held from before the first suspension, so a second tap cannot overtake this write.
        guard itemIDsInFlight.insert(item.id).inserted else { return }
        var succeeded = false
        defer {
            itemIDsInFlight.remove(item.id)
            actionFeedback = ActionFeedback(succeeded: succeeded)
        }
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
        let listsBefore = shownInLists(item.id)
        showOptimistically(request, on: item)
        let pending = PendingSnooze(itemID: item.id, request: request)
        switch request {
        case .snooze, .unsnooze: pendingSnoozes.append(pending)
        default: break
        }

        do {
            // A failed reply ends the write's claim on later reads too.
            defer {
                pendingSnoozes.removeAll { $0.id == pending.id }
                itemsInFlight[item.id] = nil
                // Whatever the outcome, a list read that started before it is out of date.
                history.writeGeneration += 1
                for id in listsBefore.compactMap(\.incidentID) {
                    incidentWriteGenerations[id, default: 0] += 1
                }
            }
            let updated = try await api.performItemAction(
                itemID: item.id,
                request: request,
                authenticated: authenticated,
                sessionToken: token
            )
            pendingSnoozes.removeAll { $0.id == pending.id }
            succeeded = true
            showEverywhere(updated)
            if details[item.id] != nil {
                details[item.id]?.item = updated
                await loadDetail(itemID: item.id)
            }
            await reloadInbox(sessionToken: token)
        } catch CowtailAPIError.refused(let message) {
            restore(item.id, from: inboxBefore)
            details[item.id] = detailBefore
            showInLists(listsBefore)
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
            // History and the incidents show the write too; only the server's lists say whether it landed.
            if history.items.contains(where: { $0.id == item.id }) {
                await loadHistory(history.filter)
            }
            for id in listsBefore.compactMap(\.incidentID) {
                await loadIncident(id: id)
            }
        }
    }

    /// Changes the shown lists for the owner's own write, moving the server's totals with them.
    private func adjustInbox(_ change: (inout ItemInbox) -> Void) {
        inbox = inbox?.changed(change)
    }

    /// Puts one refused item back where it was, leaving every other item as it is now.
    private func restore(_ itemID: String, from before: ItemInbox?) {
        guard let before else { return }
        let sections: [WritableKeyPath<ItemInbox, [Item]>] = [\.needsYou, \.withHermes, \.upcoming]
        adjustInbox { current in
            for section in sections {
                current[keyPath: section].removeAll { $0.id == itemID }
                guard let index = before[keyPath: section].firstIndex(where: { $0.id == itemID }) else { continue }
                current[keyPath: section].insert(before[keyPath: section][index], at: min(index, current[keyPath: section].count))
            }
        }
    }

    private func showOptimistically(_ request: ItemActionRequest, on item: Item) {
        inbox = inbox?.showing(request, on: item)
        let shown = ItemInbox.item(item, showing: request)
        details[item.id]?.item = shown
        itemsInFlight[item.id] = shown
        showEverywhere(shown)
    }

    /// The server's copy, or the item as an action still on its way shows it.
    private func overlaid(_ item: Item) -> Item {
        itemsInFlight[item.id] ?? item
    }

    private func overlaid(_ detail: IncidentDetail) -> IncidentDetail {
        var shown = detail
        shown.members = detail.members.map(overlaid)
        return shown
    }

    /// One list's copy of an item: History's when `incidentID` is nil, else that incident's member.
    private struct ShownItem {
        let item: Item
        let incidentID: String?
    }

    /// Each copy of the item that History and the loaded incidents show.
    private func shownInLists(_ itemID: String) -> [ShownItem] {
        let historyCopy = history.items.first { $0.id == itemID }.map { ShownItem(item: $0, incidentID: nil) }
        let members = confirmedIncidents.compactMap { id, detail in
            detail.members.first { $0.id == itemID }.map { ShownItem(item: $0, incidentID: id) }
        }
        return [historyCopy].compactMap { $0 } + members
    }

    /// Puts each copy back in its own list.
    private func showInLists(_ copies: [ShownItem]) {
        for copy in copies {
            if let id = copy.incidentID {
                guard let index = confirmedIncidents[id]?.members.firstIndex(where: { $0.id == copy.item.id }) else { continue }
                confirmedIncidents[id]?.members[index] = copy.item
                confirm(nil, incidentID: id)
            } else if let index = history.items.firstIndex(where: { $0.id == copy.item.id }) {
                history.items[index] = copy.item
            }
        }
    }

    /// Shows the item in every list that holds a copy of it.
    private func showEverywhere(_ item: Item) {
        showInLists(shownInLists(item.id).map { ShownItem(item: item, incidentID: $0.incidentID) })
    }

    /// The snooze picker's presets, worked out by the server in this device's zone.
    func snoozeOptions(timeZone: TimeZone = .current) async throws -> [SnoozeOption] {
        guard let token = await sessionToken() else {
            throw CowtailAPIError.requestFailed(Self.signInMessage)
        }
        return try await api.fetchSnoozeOptions(timeZone: timeZone.identifier, sessionToken: token)
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
            actionFeedback = ActionFeedback(succeeded: false)
            return
        }
        alertActionsInFlight.insert(item.id)
        var succeeded = false
        defer {
            alertActionsInFlight.remove(item.id)
            actionFeedback = ActionFeedback(succeeded: succeeded)
        }

        do {
            try await api.performAlertAction(alertID: alertID, action: action, note: note, sessionToken: token)
            succeeded = true
            await loadDetail(itemID: item.id)
            await reloadInbox(sessionToken: token)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            actionErrors[item.id] = error.localizedDescription
        }
    }

    // MARK: Runbook

    var shownRunID: String? {
        runbook.selectedRunID ?? hermes?.recentRuns.first?.id
    }

    /// Asks Hermes to run a script, for an item when `itemID` is set. The owner has accepted the
    /// script's prompt when it has one. Face ID gates it as it gates approvals: the server's word
    /// on the script and this device's setting both count. The run is the server's to create, so
    /// the script's button waits for the reply.
    func startRun(_ script: RunbookScript, itemID: String? = nil) async {
        guard runbook.scriptsStarting.insert(script.id).inserted else { return }
        defer { runbook.scriptsStarting.remove(script.id) }
        let report: (String?) -> Void = { message in
            if message != nil {
                self.actionFeedback = ActionFeedback(succeeded: false)
            }
            if let itemID {
                self.actionErrors[itemID] = message
            } else {
                self.runbook.error = message
            }
        }
        report(nil)

        var authenticated: Bool?
        if script.asksToConfirm, script.needsAuth || requiresApprovalAuthentication() {
            guard await authenticator.authenticate(reason: "Confirm running “\(script.name)”.") else {
                report("Running this script needs Face ID or your passcode.")
                return
            }
            authenticated = true
        }
        guard let token = await sessionToken() else {
            report(Self.signInMessage)
            return
        }

        let key = "\(script.id)\n\(itemID ?? "")"
        let requestID = runbook.unansweredRequests[key] ?? UUID().uuidString
        runbook.unansweredRequests[key] = requestID
        do {
            let run = try await api.startRunbookRun(
                requestID: requestID,
                scriptID: script.id,
                itemID: itemID,
                confirmed: script.asksToConfirm,
                authenticated: authenticated,
                sessionToken: token
            )
            runbook.unansweredRequests[key] = nil
            actionFeedback = ActionFeedback(succeeded: true)
            runbook.selectedRunID = run.id
            runbook.detail = RunbookRunDetail(run: run, output: "")
            if let itemID {
                if details[itemID] != nil {
                    await loadDetail(itemID: itemID)
                }
                await reloadInbox(sessionToken: token)
            }
            await refreshHermes(sessionToken: token)
        } catch CowtailAPIError.refused(let message) {
            // The server's answer: nothing was queued.
            runbook.unansweredRequests[key] = nil
            report(message)
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            report("Cowtail has not confirmed this run. Run it again to check; it will not run twice.")
        }
    }

    func selectRun(_ id: String) {
        runbook.selectedRunID = id
        if runbook.detail?.run.id != id {
            runbook.detail = nil
        }
    }

    /// Reads the run every `interval` until it ends, then rereads Hermes, so its script's button
    /// frees and the run moves into the recent runs.
    func followRun(id: String, interval: Duration = .seconds(1)) async {
        guard let token = await sessionToken() else { return }
        while !Task.isCancelled {
            do {
                let detail = try await api.fetchRunbookRun(id: id, sessionToken: token)
                guard shownRunID == id else { return }
                runbook.detail = detail
                runbook.error = nil
                if !detail.run.active {
                    await refreshHermes(sessionToken: token)
                    return
                }
            } catch {
                guard !NetworkErrorClassifier.isCancellation(error) else { return }
                runbook.error = error.localizedDescription
            }
            try? await Task.sleep(for: interval)
        }
    }

    // MARK: History

    /// Loads the first page for a new filter; a refresh of the same filter reloads as many
    /// items as are already shown, so the owner keeps their place.
    func loadHistory(_ filter: HistoryFilter) async {
        let shown = filter == history.filter && history.query != nil ? history.items.count : 0
        history.filter = filter
        guard let token = await sessionToken() else {
            history.error = Self.signInMessage
            return
        }
        history.isLoading = true
        defer { history.isLoading = false }

        var firstPage = filter.query()
        firstPage.limit = min(500, max(firstPage.limit, shown))
        let query = firstPage
        let generation = history.writeGeneration
        do {
            async let page = fetchHistoryPage(query, sessionToken: token)
            async let stats = api.fetchItemStats(query, sessionToken: token)
            async let sources = api.fetchItemSources(sessionToken: token)
            let (loadedPage, loadedStats, loadedSources) = try await (page, stats, sources)
            guard filter == history.filter, generation == history.writeGeneration else { return }
            history.sources = loadedSources
            history.query = query.continuing(loadedPage)
            history.items = loadedPage.items.map(overlaid)
            history.receivedAt = .now
            history.dayCounts = Self.dayCounts(loadedPage.days)
            history.cursor = loadedPage.nextCursor
            history.stats = loadedStats
            history.error = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            history.error = error.localizedDescription
        }
    }

    func loadMoreHistory() async {
        // Reserved before the first suspension, so two triggers never read the same page twice.
        guard let cursor = history.cursor, var query = history.query, !history.isLoading else { return }
        history.isLoading = true
        defer { history.isLoading = false }
        guard let token = await sessionToken() else { return }
        let filter = history.filter
        let generation = history.writeGeneration
        query.cursor = cursor
        do {
            let page = try await fetchHistoryPage(query, sessionToken: token)
            guard filter == history.filter, generation == history.writeGeneration else { return }
            history.items += page.items.map(overlaid)
            history.dayCounts.merge(Self.dayCounts(page.days)) { _, newer in newer }
            history.cursor = page.nextCursor
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            history.error = error.localizedDescription
        }
    }

    /// The server filters after it pages, so a page can hold no match yet still continue:
    /// read on until one matches or the list ends.
    /// ponytail: at most 10 pages per call; the Load older button continues past that.
    private func fetchHistoryPage(_ query: ItemListQuery, sessionToken token: String) async throws -> ItemPage {
        var query = query
        var page = try await api.fetchItems(query, sessionToken: token)
        var pages = 1
        while page.items.isEmpty, page.nextCursor != nil, pages < 10 {
            query = query.continuing(page)
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

extension ItemInbox {
    /// The lists after `change`, the server's totals moved by as many items as each list moved.
    func changed(_ change: (inout ItemInbox) -> Void) -> ItemInbox {
        var current = self
        change(&current)
        current.counts.needsYou += current.needsYou.count - needsYou.count
        current.counts.withHermes += current.withHermes.count - withHermes.count
        current.counts.upcoming += current.upcoming.count - upcoming.count
        return current
    }

    /// The item as the owner's own write leaves it.
    static func item(_ item: Item, showing request: ItemActionRequest) -> Item {
        var moved = item
        if request.isAnswer {
            moved.availableActions.removeAll(where: \.isAnswer)
        }
        // Snoozed, it offers Unsnooze until the server's own list replaces this one.
        moved.availableActions.removeAll { $0 == .unsnooze }
        switch request {
        case .ack:
            moved.availableActions.removeAll { $0 == .ack }
            moved.state = .acked
            moved.needsOwner = false
        case .snooze(let until):
            moved.availableActions.append(.unsnooze)
            moved.state = .snoozed
            moved.snoozedUntil = until
            // Snoozed already, the server's answer stands.
            moved.needsOwnerWhenOpen = item.state == .snoozed ? item.needsOwnerWhenOpen : item.needsOwner
            moved.needsOwner = false
        case .unsnooze:
            // The server named where the item returns to.
            moved.state = .open
            moved.snoozedUntil = nil
            moved.needsOwner = item.needsOwnerWhenOpen == true
            moved.needsOwnerWhenOpen = nil
        default:
            moved.needsOwner = false
        }
        return moved
    }

    /// The inbox with the owner's own write shown on `item`.
    func showing(_ request: ItemActionRequest, on item: Item) -> ItemInbox {
        let moved = Self.item(item, showing: request)
        return changed { current in
            current.needsYou.removeAll { $0.id == item.id }
            current.withHermes.removeAll { $0.id == item.id }
            current.upcoming.removeAll { $0.id == item.id }
            switch request {
            case .snooze(let until):
                // Upcoming is the soonest return first; the server's next read keeps that order.
                let index = current.upcoming.firstIndex { ($0.snoozedUntil ?? .distantFuture) > until }
                current.upcoming.insert(moved, at: index ?? current.upcoming.endIndex)
            case .unsnooze where moved.needsOwner:
                current.needsYou.insert(moved, at: 0)
            default:
                current.withHermes.insert(moved, at: 0)
            }
        }
    }

    /// A snooze or unsnooze still waiting for its reply, shown over a read from the server. A
    /// read that already shows the write's result keeps the server's own fields.
    func showingPending(_ request: ItemActionRequest, on itemID: String) -> ItemInbox {
        guard let item = item(withID: itemID) else { return self }
        switch request {
        case .snooze(let until) where item.state == .snoozed && item.snoozedUntil == until:
            return self
        case .unsnooze where item.state != .snoozed:
            return self
        case .snooze, .unsnooze:
            return showing(request, on: item)
        default:
            return self
        }
    }
}

@MainActor
@Observable
final class HistoryState {
    fileprivate(set) var filter = HistoryFilter()
    fileprivate(set) var items: [Item] = []
    fileprivate(set) var dayCounts: [String: Int] = [:]
    fileprivate(set) var stats: ItemStats?
    fileprivate(set) var sources: [String] = []
    fileprivate(set) var receivedAt: Date?
    fileprivate(set) var error: String?
    fileprivate(set) var isLoading = false
    fileprivate var cursor: String?
    /// The query the current history pages came from; continuations reuse its bounds.
    fileprivate var query: ItemListQuery?
    /// Bumped each time an item action settles, so a History read taken before is discarded.
    fileprivate var writeGeneration = 0

    var hasMore: Bool { cursor != nil }
}

@MainActor
@Observable
final class RunbookState {
    /// The run the Hermes tab follows once the owner started or picked one; the newest otherwise.
    fileprivate(set) var selectedRunID: String?
    fileprivate(set) var detail: RunbookRunDetail?
    fileprivate(set) var error: String?
    /// Scripts whose run request is on its way; their buttons wait for the reply.
    fileprivate(set) var scriptsStarting: Set<String> = []
    /// Run requests the server never answered, by script and item. The next tap sends the same
    /// request again, so the server returns the run it may have queued and queues no second one.
    fileprivate var unansweredRequests: [String: String] = [:]
}
