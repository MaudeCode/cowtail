import Foundation

protocol RoundupDataClient: Sendable {
    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem]
    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix]
}

/// The roundup reads alerts and fixes with the owner's session, like every other item read.
extension CowtailAPI: RoundupDataClient {
    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        try await fetchAlerts(from: from, to: to, sessionToken: roundupSessionToken())
    }

    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix] {
        try await fetchFixes(from: from, to: to, sessionToken: roundupSessionToken())
    }

    private func roundupSessionToken() async throws -> String {
        guard let token = await AppSessionManager.shared.refreshSessionIfPossible() else {
            throw CowtailAPIError.requestFailed(await CowtailStore.signInMessage)
        }
        return token
    }
}
