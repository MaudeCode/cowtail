import Foundation

actor SeededCowtailAPI: CowtailAPIClient, RoundupDataClient {
    enum Mode {
        case success(
            alerts: [AlertItem],
            health: HealthSummary,
            fixesByAlertID: [String: [AlertFix]],
            roundupAlerts: [AlertItem],
            roundupFixes: [AlertFix]
        )
        case alertListFailure(
            message: String,
            health: HealthSummary
        )
    }

    private var mode: Mode

    init(mode: Mode) {
        self.mode = mode
    }

    func fetchAlerts(from _: Date, to _: Date) async throws -> [AlertItem] {
        switch mode {
        case .success(let alerts, _, _, _, _):
            alerts.sorted { $0.timestamp > $1.timestamp }
        case .alertListFailure(let message, _):
            throw CowtailAPIError.requestFailed(message)
        }
    }

    func fetchAlert(id: String) async throws -> AlertItem? {
        switch mode {
        case let .success(alerts, _, _, roundupAlerts, _):
            return (alerts + roundupAlerts).first { $0.id == id }
        case .alertListFailure:
            return nil
        }
    }

    func fetchFixes(alertIDs: [String]) async throws -> [AlertFix] {
        switch mode {
        case let .success(_, _, fixesByAlertID, _, _):
            return alertIDs
                .flatMap { fixesByAlertID[$0] ?? [] }
                .sorted { $0.timestamp > $1.timestamp }
        case .alertListFailure:
            return []
        }
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        switch mode {
        case .success(_, let health, _, _, _):
            return health
        case .alertListFailure(_, let health):
            return health
        }
    }

    func fetchRoundupAlerts(from _: Date, to _: Date) async throws -> [AlertItem] {
        switch mode {
        case .success(_, _, _, let roundupAlerts, _):
            return roundupAlerts.sorted { $0.timestamp > $1.timestamp }
        case .alertListFailure:
            return []
        }
    }

    func fetchRoundupFixes(from _: Date, to _: Date) async throws -> [AlertFix] {
        switch mode {
        case .success(_, _, _, _, let roundupFixes):
            return roundupFixes.sorted { $0.timestamp > $1.timestamp }
        case .alertListFailure:
            return []
        }
    }

    func performAlertAction(
        alertID: String,
        action: AlertHumanAction,
        note: String?,
        sessionToken _: String
    ) async throws -> AlertItem {
        switch mode {
        case let .success(alerts, health, fixesByAlertID, roundupAlerts, roundupFixes):
            guard let current = (alerts + roundupAlerts).first(where: { $0.id == alertID }) else {
                throw CowtailAPIError.requestFailed("Alert not found in seeded API.")
            }
            if action == .retryInvestigation, current.investigation?.canRetry != true {
                throw CowtailAPIError.requestFailed("This investigation cannot be retried.")
            }
            let updated = current.applying(action: action, note: note)
            mode = .success(
                alerts: alerts.map { $0.id == alertID ? updated : $0 },
                health: health,
                fixesByAlertID: fixesByAlertID,
                roundupAlerts: roundupAlerts.map { $0.id == alertID ? updated : $0 },
                roundupFixes: roundupFixes
            )
            return updated
        case .alertListFailure(let message, _):
            throw CowtailAPIError.requestFailed(message)
        }
    }
}
