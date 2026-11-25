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

/// What the roundup shows for its route: the client's alerts and fixes, or why there are none.
enum RoundupLoad {
    case loaded(alerts: [AlertItem], fixes: [AlertFix])
    case failed(String)
}

extension RoundupDataClient {
    /// Reads the route's alerts and fixes, each once, from the start of its first day to the end of its last,
    /// in `timeZone`.
    func loadRoundup(_ route: RoundupRoute, in timeZone: TimeZone) async -> RoundupLoad {
        guard let fromDate = route.startOfFirstDay(in: timeZone),
              let toDate = route.endOfLastDay(in: timeZone),
              fromDate <= toDate
        else { return .failed(CowtailCopy.roundupInvalidRangeMessage) }

        do {
            async let alerts = fetchRoundupAlerts(from: fromDate, to: toDate)
            async let fixes = fetchRoundupFixes(from: fromDate, to: toDate)
            return try await .loaded(alerts: alerts, fixes: fixes)
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}

extension RoundupRoute {
    /// Noon on a `yyyy-MM-dd` day in `timeZone`, or nil when the text is not a date.
    static func noon(of dateOnly: String, in timeZone: TimeZone) -> Date? {
        let components = dateOnly.split(separator: "-").map(String.init)
        guard components.count == 3,
              let year = Int(components[0]),
              let month = Int(components[1]),
              let day = Int(components[2]) else {
            return nil
        }

        return calendar(in: timeZone).date(from: DateComponents(
            timeZone: timeZone,
            year: year,
            month: month,
            day: day,
            hour: 12,
            minute: 0,
            second: 0
        ))
    }

    func startOfFirstDay(in timeZone: TimeZone) -> Date? {
        Self.noon(of: from, in: timeZone).map { Self.calendar(in: timeZone).startOfDay(for: $0) }
    }

    func endOfLastDay(in timeZone: TimeZone) -> Date? {
        let calendar = Self.calendar(in: timeZone)
        guard let noon = Self.noon(of: to, in: timeZone),
              let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: noon)) else {
            return nil
        }
        return nextDay.addingTimeInterval(-1)
    }

    private static func calendar(in timeZone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }
}
