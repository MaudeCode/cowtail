import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedRoundupTests: XCTestCase {
    func testPopulatedRoundupShowsSummaryAndOutcomes() throws {
        try assertRoundup(.roundupPopulated, contains: [
            "section.roundup.fixed",
            "section.roundup.self-resolved",
            "card.roundup.fixes",
        ])
    }

    func testEmptyRoundupShowsQuietDay() throws {
        try assertRoundup(.roundupEmpty, contains: ["card.roundup.quiet-day"])
    }

    private func assertRoundup(_ scenario: UITestScenario.Name, contains identifiers: [String]) throws {
        let router = UniversalLinkRouter.shared
        defer { router.openInbox() }
        let url = try XCTUnwrap(AppConfig.resolvePublicURL(from: "/roundup"))
        XCTAssertTrue(router.handle(url))
        XCTAssertEqual(router.selectedTab, .history)

        let client = SeededCowtailAPI(seed: UITestScenario(named: scenario).seed.server)
        let screen = try HostedScreen(RoundupView(roundupRoute: router.roundupRoute)
            .environment(\.roundupDataClient, client))
        defer { screen.close() }

        screen.assertVisible(["screen.roundup", "card.roundup.summary"] + identifiers)
    }
}
