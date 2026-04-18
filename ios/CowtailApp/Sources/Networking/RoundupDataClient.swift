import Foundation

protocol RoundupDataClient: Sendable {
    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem]
    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix]
}

extension CowtailAPI: RoundupDataClient {
    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        try await fetchAlerts(from: from, to: to)
    }

    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix] {
        try await fetchFixes(from: from, to: to)
    }
}
