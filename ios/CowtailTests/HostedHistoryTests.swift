import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedHistoryTests: XCTestCase {
    func testHistoryShowsStatsAndNamedFilter() throws {
        let screen = try host(.inboxPopulated)
        defer { screen.close() }
        let sections = ["section.Outcomes", "section.Time to resolve"]
        screen.assertVisible(sections + ["button.history.filter", "row.history.noise-rate"])
        XCTAssertEqual(screen.element("button.history.filter")?.accessibilityLabel, "Filter")
        screen.assertVerticalOrder(sections)
    }

    func testRoundupRowOpensRoundup() throws {
        let screen = try host(.roundupPopulated)
        defer { screen.close() }
        try screen.activate("row.history.roundup")
        screen.assertVisible(["screen.roundup", "card.roundup.summary"])
    }

    func testRemovingKindChipClearsFilter() throws {
        let store = UITestScenario.fixtureStore(.inboxPopulated)
        let screen = try HostedScreen(FilteredHistory().environmentObject(store).environmentObject(UniversalLinkRouter.shared))
        defer { screen.close() }

        let chip = "chip.history.kind"
        let alertID = "alert-crashloop"
        screen.assertVisible([chip])
        XCTAssertEqual(screen.element(chip)?.accessibilityLabel, "Remove filter approval")
        let filtered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                store.historyStats != nil && !store.historyItems.contains { $0.id == alertID }
            }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [filtered], timeout: 10), .completed)

        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                screen.element(chip) == nil && store.historyItems.contains { $0.id == alertID }
            }
        }, object: nil)
        try screen.activate(chip)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 10), .completed)
    }

    private struct FilteredHistory: View {
        @State private var filter = HistoryFilter(kind: .approval)

        var body: some View {
            NavigationStack { HistoryView(filter: $filter) }
        }
    }

    private func host(_ scenario: UITestScenario.Name) throws -> HostedScreen {
        let router = UniversalLinkRouter.shared
        router.openInbox()
        router.selectedTab = .history
        let client = SeededCowtailAPI(seed: UITestScenario(named: scenario).seed.server)
        return try HostedScreen(ContentView()
            .environmentObject(UITestScenario.fixtureStore(scenario))
            .environmentObject(router)
            .environment(\.roundupDataClient, client))
    }
}
