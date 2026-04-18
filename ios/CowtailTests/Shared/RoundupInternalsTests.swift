import XCTest
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
        let api = SeededCowtailAPI(mode: seed.apiMode)
        let view = RoundupView(roundupRoute: RoundupRoute(from: "2026-04-14", to: "2026-04-14"))
        let storedPropertyLabels = Mirror(reflecting: view).children.compactMap(\.label)

        XCTAssertFalse(storedPropertyLabels.contains("api"))
        XCTAssertTrue(storedPropertyLabels.contains { $0.contains("roundupDataClient") })

        let roundupAlerts = try await api.fetchRoundupAlerts(from: .distantPast, to: .distantFuture)
        let roundupFixes = try await api.fetchRoundupFixes(from: .distantPast, to: .distantFuture)

        XCTAssertEqual(roundupAlerts.map(\.id), seed.roundupAlerts.map(\.id))
        XCTAssertEqual(roundupFixes.map(\.id), seed.roundupFixes.map(\.id))
    }
}
