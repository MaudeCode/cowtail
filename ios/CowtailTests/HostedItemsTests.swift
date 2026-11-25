import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedItemsTests: XCTestCase {
    func testKnownAlertLinkShowsItsItem() throws {
        let screen = try alertLink("/alerts/alert-1", scenario: .alertDeepLinkKnown)
        defer { screen.close() }
        screen.assertVisible(["screen.item-detail", "text.item.title"])
        XCTAssertEqual(screen.element("text.item.title")?.accessibilityLabel, "KubePodCrashLooping")
        XCTAssertTrue(screen.hasLabel("Cowtail Web", traits: .link))
    }

    func testUnknownAlertLinkShowsMissingItem() throws {
        let screen = try alertLink("/alerts/missing-alert", scenario: .alertDeepLinkMissing)
        defer { screen.close() }
        screen.assertVisible(["screen.item-missing"])
    }

    func testTimelineShowsEventsAfterDetailsAndFix() throws {
        let screen = try host(.item("alert-replicas"))
        defer { screen.close() }
        let events = ["created", "repeated", "dispatched", "hermes_update", "notified", "action_taken", "state_changed", "resolved"]
        let sections = ["Details", "Fix", "Timeline", "Past occurrences"].map { "section.\($0)" }
        screen.assertVisible(["screen.item-detail", "row.prior-occurrence.alert-replicas-prior-1"]
            + events.map { "event.\($0)" } + sections)
        screen.assertVerticalOrder(sections)
    }

    func testEvidenceStartsCollapsedAndOpensToItsSteps() throws {
        let screen = try host(.item("alert-replicas"))
        defer { screen.close() }
        screen.assertVisible(["event.hermes_update"])
        let step = "1 · Read the replica's last termination state"
        XCTAssertFalse(screen.hasLabel(step))
        try screen.activateButton("Evidence · 2 steps")
        XCTAssertTrue(screen.hasLabel(step))
    }

    func testUploadedSourceIconUsesSourceName() throws {
        let screen = try host(.item("done-deploy"))
        defer { screen.close() }
        screen.assertVisible(["icon.source.image"])
        XCTAssertEqual(screen.element("icon.source.image")?.accessibilityLabel, "Deployer")
    }

    func testFallbackSourceIconUsesSourceName() throws {
        let screen = try host(.item("alert-replicas"))
        defer { screen.close() }
        screen.assertVisible(["icon.source.symbol"])
        XCTAssertEqual(screen.element("icon.source.symbol")?.accessibilityLabel, "Alertmanager")
    }

    func testActionsArePinnedAboveTabBar() throws {
        let router = UniversalLinkRouter.shared
        router.openItem("alert-crashloop")
        defer { router.openInbox() }
        let screen = try HostedScreen(ContentView()
            .environmentObject(UITestScenario.fixtureStore(.inboxPopulated))
            .environmentObject(router))
        defer { screen.close() }
        let actions = ["ack", "snooze", "retry", "mark-noise", "escalate"]
            .map { "button.item.\($0).alert-crashloop" }
        screen.assertVisible(["area.item.actions"] + actions)
        let area = try XCTUnwrap(screen.element("area.item.actions"))
        let tabBar = try XCTUnwrap(screen.firstView(ofType: UITabBar.self))
        for action in actions {
            let frame = try XCTUnwrap(screen.element(action)?.accessibilityFrame)
            XCTAssertTrue(area.accessibilityFrame.intersects(frame))
            XCTAssertGreaterThanOrEqual(frame.width, 44, action)
            XCTAssertGreaterThanOrEqual(frame.height, 44, action)
            XCTAssertLessThanOrEqual(frame.maxY, tabBar.accessibilityFrame.minY)
        }
    }

    func testPickingSnoozeMovesItemIntoUpcoming() throws {
        let store = UITestScenario.fixtureStore(.inboxPopulated)
        let screen = try HostedScreen(NavigationStack { ItemDestinationView(route: .item("alert-crashloop")) }
            .environmentObject(store)
            .task { await store.refresh() })
        defer { screen.close() }
        try screen.activate("button.item.snooze.alert-crashloop")
        try screen.activate("button.snooze.4h")
        screen.assertGone("button.snooze.4h")
        XCTAssertTrue(store.inbox?.upcoming.contains { $0.id == "alert-crashloop" } == true)
    }

    private func host(_ route: AppRoute, scenario: UITestScenario.Name = .inboxPopulated) throws -> HostedScreen {
        let store = UITestScenario.fixtureStore(scenario)
        return try HostedScreen(NavigationStack { ItemDestinationView(route: route) }.environmentObject(store))
    }

    private func alertLink(_ path: String, scenario: UITestScenario.Name) throws -> HostedScreen {
        let router = UniversalLinkRouter.shared
        defer { router.openInbox() }
        XCTAssertTrue(router.handle(try XCTUnwrap(AppConfig.resolvePublicURL(from: path))))
        let route = try XCTUnwrap(router.inboxPath.last)
        return try host(route, scenario: scenario)
    }
}
