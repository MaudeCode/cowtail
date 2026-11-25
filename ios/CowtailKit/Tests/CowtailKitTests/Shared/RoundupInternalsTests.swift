import XCTest
@testable import CowtailKit

@MainActor
final class RoundupInternalsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        UniversalLinkRouter.shared.openInbox()
    }

    func testRoundupURLOpensTheRoundupUnderHistoryAndParsesDateRange() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/roundup?from=2026-04-10&to=2026-04-11"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .history)
        XCTAssertEqual(router.historyPath, [.roundup(RoundupRoute(from: "2026-04-10", to: "2026-04-11"))])
    }

    func testRoundupURLFallsBackMissingToDateFromFromDate() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/roundup?from=2026-04-12"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-12", to: "2026-04-12"))
    }

    func testTheRoundupReadsItsDaysFromTheClientOnceAndShowsWhatItSends() async {
        let seed = UITestScenario(named: .inboxPopulated).seed.server
        let timeZone = TimeZone(identifier: AppConfig.roundupTimeZoneIdentifier) ?? .current
        let expectedRange = Self.expectedRoundupRange(from: "2026-04-14", to: "2026-04-14")
        let client = RoundupDataClientSpy(alerts: seed.roundupAlerts, fixes: seed.roundupFixes)

        let load = await client.loadRoundup(RoundupRoute(from: "2026-04-14", to: "2026-04-14"), in: timeZone)

        guard case let .loaded(alerts, fixes) = load else {
            return XCTFail("Expected the roundup to load, got \(load)")
        }
        XCTAssertEqual(alerts.map(\.id), seed.roundupAlerts.map(\.id))
        XCTAssertEqual(fixes.map(\.id), seed.roundupFixes.map(\.id))
        let snapshot = await client.snapshot()
        XCTAssertEqual(snapshot.alertRequestCount, 1)
        XCTAssertEqual(snapshot.fixRequestCount, 1)
        XCTAssertEqual(snapshot.alertRequestRange?.from, expectedRange.from)
        XCTAssertEqual(snapshot.alertRequestRange?.to, expectedRange.to)
        XCTAssertEqual(snapshot.fixRequestRange?.from, expectedRange.from)
        XCTAssertEqual(snapshot.fixRequestRange?.to, expectedRange.to)
    }

    private static func expectedRoundupRange(from fromDate: String, to toDate: String) -> (from: Date, to: Date) {
        let timeZone = TimeZone(identifier: AppConfig.roundupTimeZoneIdentifier) ?? .current
        let calendar = Calendar(identifier: .gregorian)
        let from = Self.roundupBoundary(dateOnly: fromDate, in: timeZone, calendar: calendar, endOfDay: false)
        let to = Self.roundupBoundary(dateOnly: toDate, in: timeZone, calendar: calendar, endOfDay: true)
        return (from: from, to: to)
    }

    private static func roundupBoundary(dateOnly: String, in timeZone: TimeZone, calendar: Calendar, endOfDay: Bool) -> Date {
        var calendar = calendar
        calendar.timeZone = timeZone

        let components = dateOnly.split(separator: "-").map(String.init)
        precondition(components.count == 3, "Invalid roundup date")

        let year = Int(components[0])!
        let month = Int(components[1])!
        let day = Int(components[2])!

        let midpoint = calendar.date(from: DateComponents(
            timeZone: timeZone,
            year: year,
            month: month,
            day: day,
            hour: 12,
            minute: 0,
            second: 0
        ))!

        let startOfDay = calendar.startOfDay(for: midpoint)
        if !endOfDay {
            return startOfDay
        }

        let nextDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!
        return nextDay.addingTimeInterval(-1)
    }
}

private actor RoundupDataClientSpy: RoundupDataClient {
    private let alerts: [AlertItem]
    private let fixes: [AlertFix]
    private var alertRequestCountStorage = 0
    private var fixRequestCountStorage = 0
    private var alertRequestRangeStorage: RequestRange?
    private var fixRequestRangeStorage: RequestRange?

    init(alerts: [AlertItem], fixes: [AlertFix]) {
        self.alerts = alerts
        self.fixes = fixes
    }

    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        alertRequestCountStorage += 1
        alertRequestRangeStorage = RequestRange(from: from, to: to)
        return alerts
    }

    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix] {
        fixRequestCountStorage += 1
        fixRequestRangeStorage = RequestRange(from: from, to: to)
        return fixes
    }

    func snapshot() -> Snapshot {
        Snapshot(
            alertRequestCount: alertRequestCountStorage,
            fixRequestCount: fixRequestCountStorage,
            alertRequestRange: alertRequestRangeStorage,
            fixRequestRange: fixRequestRangeStorage
        )
    }

    struct RequestRange {
        let from: Date
        let to: Date
    }

    struct Snapshot {
        let alertRequestCount: Int
        let fixRequestCount: Int
        let alertRequestRange: RequestRange?
        let fixRequestRange: RequestRange?
    }
}
