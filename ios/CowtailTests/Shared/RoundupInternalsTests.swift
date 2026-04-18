import XCTest
import UIKit
import SwiftUI
@testable import Cowtail

@MainActor
final class RoundupInternalsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        UniversalLinkRouter.shared.openInbox()
    }

    func testRoundupUsesRenamedInternalTypes() {
        let tab: AppTab = .roundup
        XCTAssertEqual(tab, .roundup)

        let route = RoundupRoute(from: "2026-04-14", to: "2026-04-14")
        XCTAssertEqual(route.from, "2026-04-14")
        XCTAssertEqual(route.to, "2026-04-14")

        _ = RoundupView.self
        _ = RoundupHeroCard.self
        _ = RoundupStats.self
        _ = RoundupOutcomeSection.self
    }

    func testRoundupURLRoutesIntoRoundupTabAndParsesDateRange() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/roundup?from=2026-04-10&to=2026-04-11"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .roundup)
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-10", to: "2026-04-11"))
    }

    func testRoundupURLFallsBackMissingToDateFromFromDate() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/roundup?from=2026-04-12"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .roundup)
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-12", to: "2026-04-12"))
    }

    func testRoundupViewUsesInjectedRoundupDataClientAndSeededRoundupData() async throws {
        let seed = UITestScenario(named: .inboxPopulated).seed
        let view = RoundupView(roundupRoute: RoundupRoute(from: "2026-04-14", to: "2026-04-14"))
        XCTAssertFalse(Mirror(reflecting: view).children.compactMap(\.label).contains("api"))

        let expectedRange = Self.expectedRoundupRange(from: "2026-04-14", to: "2026-04-14")
        let client = RoundupDataClientSpy(
            alerts: seed.roundupAlerts,
            fixes: seed.roundupFixes
        )
        let host = UIHostingController(
            rootView: RoundupHost(
                roundupRoute: RoundupRoute(from: "2026-04-14", to: "2026-04-14"),
                client: client
            )
        )
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = host
        window.isHidden = false

        host.beginAppearanceTransition(true, animated: false)
        host.endAppearanceTransition()

        try await client.waitUntilLoaded(timeout: 2)

        let snapshot = await client.snapshot()
        XCTAssertEqual(snapshot.alertRequestCount, 1)
        XCTAssertEqual(snapshot.fixRequestCount, 1)
        XCTAssertEqual(snapshot.alertRequestRange?.from, expectedRange.from)
        XCTAssertEqual(snapshot.alertRequestRange?.to, expectedRange.to)
        XCTAssertEqual(snapshot.fixRequestRange?.from, expectedRange.from)
        XCTAssertEqual(snapshot.fixRequestRange?.to, expectedRange.to)
        XCTAssertEqual(snapshot.lastAlerts.map(\.id), seed.roundupAlerts.map(\.id))
        XCTAssertEqual(snapshot.lastFixes.map(\.id), seed.roundupFixes.map(\.id))

        window.isHidden = true
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

private struct RoundupHost: View {
    let roundupRoute: RoundupRoute
    let client: any RoundupDataClient

    var body: some View {
        RoundupView(roundupRoute: roundupRoute)
            .environment(\.roundupDataClient, client)
    }
}

private actor RoundupDataClientSpy: RoundupDataClient {
    private let alerts: [AlertItem]
    private let fixes: [AlertFix]
    private var alertRequestCountStorage = 0
    private var fixRequestCountStorage = 0
    private var alertRequestRangeStorage: RequestRange?
    private var fixRequestRangeStorage: RequestRange?
    private var lastAlertsStorage: [AlertItem] = []
    private var lastFixesStorage: [AlertFix] = []

    init(alerts: [AlertItem], fixes: [AlertFix]) {
        self.alerts = alerts
        self.fixes = fixes
    }

    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        alertRequestCountStorage += 1
        alertRequestRangeStorage = RequestRange(from: from, to: to)
        lastAlertsStorage = alerts
        return alerts
    }

    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix] {
        fixRequestCountStorage += 1
        fixRequestRangeStorage = RequestRange(from: from, to: to)
        lastFixesStorage = fixes
        return fixes
    }

    func waitUntilLoaded(timeout: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while alertRequestCountStorage == 0 || fixRequestCountStorage == 0 {
            if Date() >= deadline {
                throw TimeoutError()
            }

            try await Task.sleep(for: .milliseconds(10))
        }
    }

    func snapshot() -> Snapshot {
        Snapshot(
            alertRequestCount: alertRequestCountStorage,
            fixRequestCount: fixRequestCountStorage,
            alertRequestRange: alertRequestRangeStorage,
            fixRequestRange: fixRequestRangeStorage,
            lastAlerts: lastAlertsStorage,
            lastFixes: lastFixesStorage
        )
    }

    struct TimeoutError: Error {}

    struct RequestRange {
        let from: Date
        let to: Date
    }

    struct Snapshot {
        let alertRequestCount: Int
        let fixRequestCount: Int
        let alertRequestRange: RequestRange?
        let fixRequestRange: RequestRange?
        let lastAlerts: [AlertItem]
        let lastFixes: [AlertFix]
    }
}
