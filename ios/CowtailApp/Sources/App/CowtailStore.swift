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

@MainActor
final class CowtailStore: ObservableObject {
    @Published private(set) var alerts: [AlertItem]
    @Published private(set) var alertCacheByID: [String: AlertItem]
    @Published private(set) var alertLoadErrors: [String: String]
    @Published private(set) var alertIDsLoading: Set<String>
    @Published private(set) var health: HealthSummary?
    @Published private(set) var healthErrorMessage: String?
    @Published private(set) var fixesByAlertID: [String: [AlertFix]]
    @Published private(set) var isLoading: Bool
    @Published private(set) var lastUpdated: Date?
    @Published var errorMessage: String?

    private let api: any CowtailAPIClient
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "store"
    )
    private var hasLoaded = false

    init(
        api: any CowtailAPIClient = CowtailAPI(),
        alerts: [AlertItem] = [],
        health: HealthSummary? = nil,
        fixesByAlertID: [String: [AlertFix]] = [:],
        errorMessage: String? = nil,
        hasLoaded: Bool = false
    ) {
        self.api = api
        self.alerts = alerts
        self.alertCacheByID = Dictionary(uniqueKeysWithValues: alerts.map { ($0.id, $0) })
        self.alertLoadErrors = [:]
        self.alertIDsLoading = []
        self.health = health
        self.healthErrorMessage = nil
        self.fixesByAlertID = fixesByAlertID
        self.isLoading = false
        self.errorMessage = errorMessage
        self.hasLoaded = hasLoaded
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await refresh()
    }

    func refresh() async {
        enum RefreshResult {
            case alerts(Result<[AlertItem], Error>)
            case health(Result<HealthSummary, Error>)
        }

        isLoading = true
        errorMessage = nil
        healthErrorMessage = nil
        defer {
            isLoading = false
        }

        let now = Date()
        let start = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? now

        await withTaskGroup(of: RefreshResult.self) { [api] group in
            group.addTask {
                do {
                    return .alerts(.success(try await api.fetchAlerts(from: start, to: now)))
                } catch {
                    return .alerts(.failure(error))
                }
            }

            group.addTask {
                do {
                    return .health(.success(try await fetchHealthSummaryWithRetry(from: api)))
                } catch {
                    return .health(.failure(error))
                }
            }

            for await result in group {
                switch result {
                case .alerts(.success(let fetchedAlerts)):
                    alerts = fetchedAlerts
                    for alert in fetchedAlerts {
                        alertCacheByID[alert.id] = alert
                        alertLoadErrors.removeValue(forKey: alert.id)
                    }
                    lastUpdated = .now
                    hasLoaded = true

                case .alerts(.failure(let error)):
                    guard !NetworkErrorClassifier.isCancellation(error) else { continue }
                    logger.error("refresh alerts failed: \(String(describing: error), privacy: .public)")
                    errorMessage = error.localizedDescription

                case .health(.success(let fetchedHealth)):
                    health = fetchedHealth
                    lastUpdated = .now
                    hasLoaded = true

                case .health(.failure(let error)):
                    guard !NetworkErrorClassifier.isCancellation(error) else { continue }
                    logger.error("refresh health failed: \(String(describing: error), privacy: .public)")
                    healthErrorMessage = error.localizedDescription
                }
            }
        }
    }

    func loadFixes(for alertID: String) async {
        if fixesByAlertID[alertID] != nil {
            return
        }

        do {
            fixesByAlertID[alertID] = try await api.fetchFixes(alertIDs: [alertID])
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("loadFixes failed for \(alertID, privacy: .public): \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    func alert(withID alertID: String) -> AlertItem? {
        alerts.first(where: { $0.id == alertID }) ?? alertCacheByID[alertID]
    }

    func isLoadingAlert(_ alertID: String) -> Bool {
        alertIDsLoading.contains(alertID)
    }

    func alertError(for alertID: String) -> String? {
        alertLoadErrors[alertID]
    }

    func loadAlert(id alertID: String) async {
        if alert(withID: alertID) != nil || alertIDsLoading.contains(alertID) {
            return
        }

        alertIDsLoading.insert(alertID)
        alertLoadErrors.removeValue(forKey: alertID)
        defer {
            alertIDsLoading.remove(alertID)
        }

        do {
            guard let alert = try await api.fetchAlert(id: alertID) else {
                alertLoadErrors[alertID] = "This alert could not be found."
                return
            }

            alertCacheByID[alert.id] = alert
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("loadAlert failed for \(alertID, privacy: .public): \(String(describing: error), privacy: .public)")
            alertLoadErrors[alertID] = error.localizedDescription
        }
    }
}
