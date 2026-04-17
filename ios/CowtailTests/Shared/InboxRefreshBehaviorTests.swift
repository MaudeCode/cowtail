import XCTest
@testable import Cowtail

@MainActor
final class InboxRefreshBehaviorTests: XCTestCase {
    func testInboxHeaderCardIncludesSecondsInUpdatedLabel() {
        let date = Date(timeIntervalSince1970: 15 * 60 * 60 + 4 * 60 + 5)
        let label = InboxHeaderCard.updatedLabel(
            for: date,
            timeZone: TimeZone(secondsFromGMT: 0)!,
            locale: Locale(identifier: "en_US_POSIX")
        )

        let normalizedLabel = label.replacingOccurrences(of: "\u{202F}", with: " ")
        XCTAssertEqual(normalizedLabel, "Updated 3:04:05 PM")
    }

    func testRefreshPublishesHealthBeforeAlertsComplete() async {
        let api = ControlledCowtailAPI()
        let store = CowtailStore(api: api)
        let expectedHealth = HealthSummary(
            nodes: [HealthNode(id: "n1", name: "node-1", isReady: true, cpu: 20, memory: 40)],
            cephStatus: "HEALTH_OK",
            cephMessage: "All clear",
            storageTotal: 10,
            storageUsed: 2,
            storageUnit: "TiB"
        )

        let refreshTask = Task {
            await store.refresh()
        }

        await api.waitUntilStarted()
        await api.completeHealth(with: expectedHealth)

        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(store.health, expectedHealth)

        await api.completeAlerts(with: [])
        await refreshTask.value
    }

    func testRefreshUpdatesTimestampWhenAlertsSucceedAndHealthCancels() async {
        let api = ControlledCowtailAPI()
        let store = CowtailStore(api: api)

        let refreshTask = Task {
            await store.refresh()
        }

        await api.waitUntilStarted()
        await api.completeAlerts(with: [])
        await api.failHealth(with: URLError(.cancelled))
        await refreshTask.value

        XCTAssertNotNil(store.lastUpdated)
    }
}

private actor ControlledCowtailAPI: CowtailAPIClient {
    private var alertContinuation: CheckedContinuation<[AlertItem], Error>?
    private var healthContinuation: CheckedContinuation<HealthSummary, Error>?

    func fetchAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        try await withCheckedThrowingContinuation { continuation in
            alertContinuation = continuation
        }
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        try await withCheckedThrowingContinuation { continuation in
            healthContinuation = continuation
        }
    }

    func fetchAlert(id: String) async throws -> AlertItem? {
        nil
    }

    func fetchFixes(alertIDs: [String]) async throws -> [AlertFix] {
        []
    }

    func waitUntilStarted() async {
        while alertContinuation == nil || healthContinuation == nil {
            await Task.yield()
        }
    }

    func completeAlerts(with alerts: [AlertItem]) {
        alertContinuation?.resume(returning: alerts)
        alertContinuation = nil
    }

    func failAlerts(with error: Error) {
        alertContinuation?.resume(throwing: error)
        alertContinuation = nil
    }

    func completeHealth(with health: HealthSummary) {
        healthContinuation?.resume(returning: health)
        healthContinuation = nil
    }

    func failHealth(with error: Error) {
        healthContinuation?.resume(throwing: error)
        healthContinuation = nil
    }
}
