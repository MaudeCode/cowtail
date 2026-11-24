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
        return ItemInbox(
            needsYou: byUpdate.filter { $0.state == .open && $0.needsOwner },
            withHermes: byUpdate.filter { ($0.state == .open || $0.state == .acked) && !$0.needsOwner },
            upcoming: seed.items
                .filter { $0.state == .snoozed }
                .sorted { ($0.snoozedUntil ?? .distantFuture) < ($1.snoozedUntil ?? .distantFuture) },
            handled: byUpdate.filter { $0.state == .resolved && ($0.resolvedAt ?? .distantPast) >= dayAgo }
        )
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
        var item = seed.items[index]
        let neededOwner = item.needsOwner
        item.needsOwner = false
        if request.isAnswer {
            item.availableActions.removeAll(where: \.isAnswer)
        }
        let payload: [String: String]
        switch request {
        case .ack:
            item.state = .acked
            payload = ["type": "ack"]
        case .snooze(let until):
            item.state = .snoozed
            item.snoozedUntil = until
            item.needsOwnerWhenOpen = neededOwner
            payload = ["type": "snooze"]
        case .unsnooze:
            guard item.state == .snoozed else {
                throw CowtailAPIError.refused("Item is not snoozed")
            }
            item.state = .open
            item.snoozedUntil = nil
            item.needsOwner = item.needsOwnerWhenOpen ?? false
            item.needsOwnerWhenOpen = nil
            payload = ["type": "unsnooze"]
        case .approve: payload = ["type": "approve"]
        case .deny: payload = ["type": "deny"]
        case .choose(let option): payload = ["type": "choose", "option": option]
        case .reply(let text): payload = ["type": "reply", "text": text]
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

    /// The server's presets, worked out from the seeded clock in the zone asked for.
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
