import Foundation

/// The UI-test server: answers like Cowtail from seeded items, and applies the owner's actions.
actor SeededCowtailAPI: CowtailAPIClient, RoundupDataClient {
    struct Seed: Sendable {
        var items: [Item] = CowtailPreviewFixtures.items
        var health = CowtailPreviewFixtures.health
        var stats = CowtailPreviewFixtures.stats
        var devices = CowtailPreviewFixtures.devices
        var roundupAlerts = CowtailPreviewFixtures.roundupAlerts
        var roundupFixes = CowtailPreviewFixtures.roundupFixes
        /// Every item request fails with this message.
        var itemErrorMessage: String?
    }

    private var seed: Seed
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
        return ItemPage(items: items, nextCursor: nil)
    }

    func fetchItem(id: String, sessionToken _: String) async throws -> ItemDetail? {
        try requireItems()
        guard let item = seed.items.first(where: { $0.id == id }) else { return nil }
        return ItemDetail(item: item, events: events[id] ?? [])
    }

    func fetchItemStats(from _: Date?, to _: Date?, sessionToken _: String) async throws -> ItemStats {
        try requireItems()
        return seed.stats
    }

    func performItemAction(itemID: String, request: ItemActionRequest, sessionToken _: String) async throws -> Item {
        guard let index = seed.items.firstIndex(where: { $0.id == itemID }) else {
            throw CowtailAPIError.refused("Item not found")
        }
        var item = seed.items[index]
        item.needsOwner = false
        let payload: [String: String]
        switch request {
        case .ack:
            item.state = .acked
            payload = ["type": "ack"]
        case .snooze:
            item.state = .snoozed
            payload = ["type": "snooze"]
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

    func performAlertAction(alertID _: String, action _: AlertHumanAction, sessionToken _: String) async throws {}

    func fetchDevices(sessionToken _: String) async throws -> [UserDevice] {
        seed.devices
    }

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
