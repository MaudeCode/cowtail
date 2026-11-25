import Foundation

/// The UI-test server: answers like Cowtail from seeded items, and applies the owner's actions.
actor SeededCowtailAPI: CowtailAPIClient, AuthAPIClient, RoundupDataClient {
    struct Seed: Sendable {
        var items: [Item] = CowtailPreviewFixtures.items
        var health = CowtailPreviewFixtures.health
        var stats = CowtailPreviewFixtures.stats
        var hermes = CowtailPreviewFixtures.hermes
        var devices = CowtailPreviewFixtures.devices
        var roundupAlerts = CowtailPreviewFixtures.roundupAlerts
        var roundupFixes = CowtailPreviewFixtures.roundupFixes
        /// The running maintenance windows.
        var maintenanceWindows: [MaintenanceWindow] = []
        /// Incidents whose members are the items with their summary.
        var incidents: [Incident] = []
        /// Every item request fails with this message.
        var itemErrorMessage: String?
        /// The server's OIDC provider; nil offers only Sign in with Apple.
        var oidcProviderName: String?
    }

    private var seed: Seed
    private var startedByRequest: [UUID: MaintenanceWindow] = [:]
    private var events: [String: [ItemEvent]]

    init(seed: Seed) {
        self.seed = seed
        self.events = Dictionary(uniqueKeysWithValues: seed.items.map { ($0.id, CowtailPreviewFixtures.events(for: $0)) })
    }

    private func requireItems() throws {
        if let message = seed.itemErrorMessage {
            throw CowtailAPIError.requestFailed(message)
        }
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        seed.health
    }

    func fetchInbox(sessionToken _: String) async throws -> ItemInbox {
        try requireItems()
        let byUpdate = seed.items.sorted { $0.updatedAt > $1.updatedAt }
        let dayAgo = Date.now.addingTimeInterval(-24 * 60 * 60)
        // Like the server, an incident is one row, in the first section one of its members is in.
        var seen: Set<String> = []
        let oncePerIncident = { (items: [Item]) in
            items.filter { item in item.incident.map { seen.insert($0.id).inserted } ?? true }
        }
        let needsYou = oncePerIncident(byUpdate.filter { $0.state == .open && $0.needsOwner })
        let withHermes = oncePerIncident(byUpdate.filter { ($0.state == .open || $0.state == .acked) && !$0.needsOwner })
        let upcoming = oncePerIncident(
            seed.items
                .filter { $0.state == .snoozed }
                .sorted { ($0.snoozedUntil ?? .distantFuture) < ($1.snoozedUntil ?? .distantFuture) }
        )
        let handled = oncePerIncident(byUpdate.filter { $0.state == .resolved && ($0.resolvedAt ?? .distantPast) >= dayAgo })
        return ItemInbox(needsYou: needsYou, withHermes: withHermes, upcoming: upcoming, handled: handled)
    }

    func fetchItems(_ query: ItemListQuery, sessionToken _: String) async throws -> ItemPage {
        try requireItems()
        let items = seed.items
            .filter { item in
                (query.source == nil || item.source == query.source)
                    && (query.kind == nil || item.kind == query.kind)
                    && (query.outcome == nil || item.outcome == query.outcome)
                    && (query.alertID == nil || item.alertID == query.alertID)
                    && (query.from == nil || item.createdAt >= query.from!)
                    && (query.search == nil || item.title.localizedCaseInsensitiveContains(query.search!))
            }
            .sorted { $0.createdAt > $1.createdAt }
            // Like the server, a list shows an incident once, at its oldest member.
            .filter { item in
                guard let incident = item.incident else { return true }
                return seed.items.filter { $0.incident?.id == incident.id }.min { $0.createdAt < $1.createdAt }?.id == item.id
            }
            .map { item in
                var listed = item
                listed.createdDate = Self.day(item.createdAt)
                return listed
            }
        var days: [ItemPage.Day] = []
        for item in items where days.last?.date != item.createdDate {
            let date = item.createdDate ?? ""
            days.append(ItemPage.Day(date: date, count: items.count { $0.createdDate == date }))
        }
        return ItemPage(items: items, nextCursor: nil, days: days)
    }

    private static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    func fetchItem(id: String, sessionToken _: String) async throws -> ItemDetail? {
        try requireItems()
        guard let item = seed.items.first(where: { $0.id == id }) else { return nil }
        let fixes = item.id == CowtailPreviewFixtures.replicas.id ? CowtailPreviewFixtures.roundupFixes : []
        return ItemDetail(
            item: item,
            events: events[id] ?? [],
            fixes: fixes,
            priorOccurrences: CowtailPreviewFixtures.priorOccurrences(for: item)
        )
    }

    func fetchItemGraph(itemID: String, range: ItemGraphRange, sessionToken _: String) async throws -> ItemGraph? {
        try requireItems()
        return seed.items.first { $0.id == itemID }.flatMap { CowtailPreviewFixtures.graph(for: $0, range: range) }
    }

    func fetchItemStats(_: ItemListQuery, sessionToken _: String) async throws -> ItemStats {
        try requireItems()
        return seed.stats
    }

    func performItemAction(
        itemID: String,
        request: ItemActionRequest,
        authenticated _: Bool?,
        sessionToken _: String
    ) async throws -> Item {
        guard let index = seed.items.firstIndex(where: { $0.id == itemID }) else {
            throw CowtailAPIError.refused("Item not found")
        }
        if request == .unsnooze, seed.items[index].state != .snoozed {
            throw CowtailAPIError.refused("Item is not snoozed")
        }
        // The server's result is what the app shows at once for the owner's own write.
        let item = ItemInbox.item(seed.items[index], showing: request)
        let payload: [String: String] = switch request {
        case .ack: ["type": "ack"]
        case .snooze: ["type": "snooze"]
        case .unsnooze: ["type": "unsnooze"]
        case .approve: ["type": "approve"]
        case .deny: ["type": "deny"]
        case .choose(let option): ["type": "choose", "option": option]
        case .reply(let text): ["type": "reply", "text": text]
        }
        seed.items[index] = item
        events[itemID, default: []].append(
            ItemEvent(id: "\(itemID)-action-\(events[itemID]?.count ?? 0)", at: .now, type: .actionTaken, actor: "owner", payload: payload)
        )
        return item
    }

    func performAlertAction(
        alertID _: String,
        action _: AlertHumanAction,
        note _: String?,
        sessionToken _: String
    ) async throws {}

    func fetchItemSources(sessionToken _: String) async throws -> [String] {
        try requireItems()
        return Set(seed.items.map(\.source)).sorted()
    }

    func fetchHermesStatus(sessionToken _: String) async throws -> HermesStatus {
        seed.hermes
    }

    func fetchDevices(sessionToken _: String) async throws -> [UserDevice] {
        seed.devices
    }

    /// Queues the run at the front of the recent runs; it shows the seeded output and ends at once.
    func startRunbookRun(
        requestID _: String,
        scriptID: String,
        itemID: String?,
        confirmed _: Bool,
        authenticated _: Bool?,
        sessionToken _: String
    ) async throws -> RunbookRun {
        let scripts = (seed.hermes.heartbeat?.runbook ?? []).flatMap(\.scripts)
        guard let script = scripts.first(where: { $0.id == scriptID }) else {
            throw CowtailAPIError.refused("Hermes does not report this script")
        }
        let run = RunbookRun(
            id: "run-\(seed.hermes.recentRuns.count + 1)",
            scriptID: scriptID,
            scriptName: script.name,
            itemID: itemID,
            status: .succeeded,
            active: false,
            exitCode: 0,
            createdAt: .now,
            startedAt: .now,
            finishedAt: .now
        )
        seed.hermes.recentRuns.insert(run, at: 0)
        if let itemID {
            events[itemID, default: []].append(
                ItemEvent(
                    id: "\(itemID)-run-\(run.id)",
                    at: .now,
                    type: .runStarted,
                    actor: "owner",
                    payload: ["scriptName": script.name]
                )
            )
        }
        return run
    }

    func fetchRunbookRun(id: String, sessionToken _: String) async throws -> RunbookRunDetail {
        guard let run = seed.hermes.recentRuns.first(where: { $0.id == id }) else {
            throw CowtailAPIError.requestFailed("Run not found")
        }
        return RunbookRunDetail(run: run, output: CowtailPreviewFixtures.runOutput)
    }

    /// The server's presets, worked out from the seeded clock in the zone asked for.
    func fetchIncident(id: String, sessionToken _: String) async throws -> IncidentDetail? {
        try requireItems()
        guard let incident = seed.incidents.first(where: { $0.summary.id == id }) else { return nil }
        let members = seed.items.filter { $0.incident?.id == id }.sorted { $0.createdAt > $1.createdAt }
        let events = (members.flatMap { member in
            (self.events[member.id] ?? []).map { event in
                var titled = event
                titled.itemTitle = member.title
                return titled
            }
        } + CowtailPreviewFixtures.incidentEvents(for: incident)).sorted { $0.at < $1.at }
        var shown = incident
        shown.summary.memberCount = members.count
        return IncidentDetail(incident: shown, members: members, events: events)
    }

    func fetchIncidentCandidates(id _: String, sessionToken _: String) async throws -> [Item] {
        try requireItems()
        return seed.items.filter { $0.incident == nil }.sorted { $0.createdAt > $1.createdAt }
    }

    func changeIncident(id: String, change: IncidentChange, sessionToken: String) async throws -> IncidentDetail {
        guard let index = seed.incidents.firstIndex(where: { $0.summary.id == id }) else {
            throw CowtailAPIError.refused("Incident not found")
        }
        switch change {
        case .add(let itemID):
            guard let item = seed.items.firstIndex(where: { $0.id == itemID }) else {
                throw CowtailAPIError.refused("Item not found")
            }
            seed.items[item].incident = seed.incidents[index].summary
        case .remove(let itemID):
            guard let item = seed.items.firstIndex(where: { $0.id == itemID && $0.incident?.id == id }) else {
                throw CowtailAPIError.refused("Item is not in this incident")
            }
            seed.items[item].incident = nil
        case .resolve:
            seed.incidents[index].summary.state = .resolved
            seed.incidents[index].postmortemState = .requested
            seed.incidents[index].availableActions = []
        case .requestPostmortem:
            seed.incidents[index].postmortemState = .requested
            seed.incidents[index].availableActions = []
        }
        guard let detail = try await fetchIncident(id: id, sessionToken: sessionToken) else {
            throw CowtailAPIError.refused("Incident not found")
        }
        return detail
    }

    func fetchSnoozeOptions(timeZone: String, sessionToken _: String) async throws -> [SnoozeOption] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
        let now = Date.now
        let tomorrow = calendar.startOfDay(for: now.addingTimeInterval(24 * 60 * 60))
        let morning = DateComponents(hour: 9, minute: 0)
        let tomorrowMorning = calendar.nextDate(after: tomorrow, matching: morning, matchingPolicy: .nextTime) ?? tomorrow
        var monday = morning
        monday.weekday = 2
        return [
            SnoozeOption(preset: .oneHour, until: now.addingTimeInterval(60 * 60)),
            SnoozeOption(preset: .fourHours, until: now.addingTimeInterval(4 * 60 * 60)),
            SnoozeOption(preset: .tomorrow, until: tomorrowMorning),
            SnoozeOption(
                preset: .nextMonday,
                until: calendar.nextDate(after: tomorrow, matching: monday, matchingPolicy: .nextTime) ?? tomorrowMorning
            ),
        ]
    }

    func fetchMaintenanceWindows(sessionToken _: String) async throws -> MaintenanceWindows {
        MaintenanceWindows(
            active: seed.maintenanceWindows.sorted { $0.endsAt < $1.endsAt },
            sourceChoices: Set(seed.items.map(\.source)).subtracting(["alertmanager"]).sorted()
        )
    }

    /// Starts the window the way the server does: a window naming nothing covers all alerts, and
    /// a repeated request returns its first window.
    func startMaintenanceWindow(
        _ request: MaintenanceWindowRequest,
        sessionToken _: String
    ) async throws -> MaintenanceWindow {
        if let repeated = startedByRequest[request.requestID] {
            return repeated
        }
        let sources = request.sources.isEmpty && request.matchers.isEmpty ? ["alertmanager"] : request.sources
        let window = MaintenanceWindow(
            id: "seeded-window-\(seed.maintenanceWindows.count + 1)",
            title: request.title,
            startsAt: .now,
            endsAt: .now.addingTimeInterval(request.duration),
            matchers: request.matchers,
            sources: sources,
            allAlerts: sources.contains("alertmanager") || sources.contains("*"),
            heldSources: sources.filter { $0 != "alertmanager" },
            active: true
        )
        seed.maintenanceWindows.append(window)
        startedByRequest[request.requestID] = window
        return window
    }

    func endMaintenanceWindow(id: String, sessionToken _: String) async throws -> MaintenanceWindow {
        guard let index = seed.maintenanceWindows.firstIndex(where: { $0.id == id }) else {
            throw CowtailAPIError.refused("Maintenance window not found")
        }
        var ended = seed.maintenanceWindows.remove(at: index)
        ended.active = false
        ended.endedAt = .now
        return ended
    }

    func createAuthSession(identityToken _: String) async throws -> AppAuthSession {
        Self.session
    }

    func fetchOIDCProviderName() async throws -> String? {
        seed.oidcProviderName
    }

    func redeemOIDCHandoff(code _: String, verifier _: String) async throws -> AppAuthSession {
        Self.session
    }

    func logout(sessionToken _: String) async throws {}

    private static let session = AppAuthSession(
        token: "ui-test-session-token",
        userID: "ui-test-apple-user",
        expiresAt: .now.addingTimeInterval(60 * 60)
    )

    func fetchRoundupAlerts(from _: Date, to _: Date) async throws -> [AlertItem] {
        seed.roundupAlerts.sorted { $0.timestamp > $1.timestamp }
    }

    func fetchRoundupFixes(from _: Date, to _: Date) async throws -> [AlertFix] {
        seed.roundupFixes.sorted { $0.timestamp > $1.timestamp }
    }
}

/// UI tests run on a simulator with no enrolled face; the seeded owner always confirms.
struct SeededApprovalAuthenticator: ApprovalAuthenticating {
    func authenticate(reason _: String) async -> Bool { true }
}
