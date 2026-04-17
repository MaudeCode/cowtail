import Foundation
import OSLog

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

    private let api: CowtailAPI
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "store"
    )
    private var hasLoaded = false

    init(
        api: CowtailAPI = CowtailAPI(),
        alerts: [AlertItem] = [],
        health: HealthSummary? = nil,
        fixesByAlertID: [String: [AlertFix]] = [:]
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
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await refresh()
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil
        healthErrorMessage = nil
        defer {
            isLoading = false
        }

        let now = Date()
        let start = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? now

        async let alertsTask = api.fetchAlerts(from: start, to: now)
        async let healthTask = api.fetchHealthSummary()

        var didLoadAlerts = false

        do {
            let fetchedAlerts = try await alertsTask
            alerts = fetchedAlerts
            for alert in fetchedAlerts {
                alertCacheByID[alert.id] = alert
                alertLoadErrors.removeValue(forKey: alert.id)
            }
            didLoadAlerts = true
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh alerts failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }

        do {
            health = try await healthTask
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh health failed: \(String(describing: error), privacy: .public)")
            healthErrorMessage = error.localizedDescription
        }

        if didLoadAlerts {
            lastUpdated = Date()
            hasLoaded = true
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
