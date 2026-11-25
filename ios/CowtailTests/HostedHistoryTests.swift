import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedHistoryTests: XCTestCase {
    func testHistoryShowsStatsAndNamedFilter() async throws {
        let store = UITestScenario.fixtureStore(.inboxPopulated)
        await store.loadHistory(HistoryFilter())
        let screen = try host(.inboxPopulated, store: store)
        defer { screen.close() }
        let sections = ["section.Outcomes", "section.Time to resolve"]
        screen.assertVisible(sections + ["button.history.filter", "row.history.noise-rate"])
        XCTAssertEqual(screen.element("button.history.filter")?.accessibilityLabel, "Filter")
        screen.assertVerticalOrder(sections)
    }

    func testRoundupRowOpensRoundup() throws {
        let screen = try host(.roundupPopulated, store: UITestScenario.fixtureStore(.roundupPopulated))
        defer { screen.close() }
        try screen.activate("row.history.roundup")
        screen.assertVisible(["screen.roundup", "card.roundup.summary"])
    }

    func testRemovingKindChipClearsFilter() throws {
        let store = UITestScenario.fixtureStore(.inboxPopulated)
        let screen = try host(.inboxPopulated, store: store, filter: HistoryFilter(kind: .approval))
        defer { screen.close() }

        let chip = "chip.history.kind"
        let alertID = "alert-crashloop"
        screen.assertVisible([chip])
        XCTAssertEqual(screen.element(chip)?.accessibilityLabel, "Remove filter approval")
        let filtered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                store.history.stats != nil && !store.history.items.contains { $0.id == alertID }
            }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [filtered], timeout: 10), .completed)

        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                screen.element(chip) == nil && store.history.items.contains { $0.id == alertID }
            }
        }, object: nil)
        try screen.activate(chip)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 10), .completed)
    }

    private struct HistoryStack: View {
        @State var filter: HistoryFilter

        var body: some View {
            NavigationStack {
                HistoryView(filter: $filter)
                    .navigationDestination(for: AppRoute.self) { route in
                        if case .roundup(let roundup) = route {
                            RoundupView(roundupRoute: roundup)
                        }
                    }
            }
        }
    }

    private func host(
        _ scenario: UITestScenario.Name,
        store: CowtailStore,
        filter: HistoryFilter = HistoryFilter()
    ) throws -> HostedScreen {
        let client = SeededCowtailAPI(seed: UITestScenario(named: scenario).seed.server)
        return try HostedScreen(HistoryStack(filter: filter)
            .environment(store)
            .environmentObject(UniversalLinkRouter.shared)
            .environment(\.roundupDataClient, client))
    }
}
