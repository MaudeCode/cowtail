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

    func testDigestURLRoutesIntoRoundupTabAndParsesDateRange() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/digest?from=2026-04-10&to=2026-04-11"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .roundup)
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-10", to: "2026-04-11"))
    }

    func testDigestURLFallsBackMissingToDateFromFromDate() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/digest?from=2026-04-12"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .roundup)
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-12", to: "2026-04-12"))
    }
}
