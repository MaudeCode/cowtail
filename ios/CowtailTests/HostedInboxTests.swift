import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedInboxTests: XCTestCase {
    func testPopulatedInboxShowsItsSectionsInOrder() throws {
        let screen = try hostInbox(.inboxPopulated)
        defer { screen.close() }
        let sections = ["section.Needs you", "section.Hermes is on it", "section.Upcoming"]
        screen.assertVisible(sections)
        screen.assertVerticalOrder(sections)
    }

    func testHermesStatusIsBesideClusterStatus() throws {
        let screen = try hostInbox(.inboxPopulated)
        defer { screen.close() }
        screen.assertVisible(["chip.inbox.cluster", "chip.inbox.hermes"])
        let cluster = try XCTUnwrap(screen.element("chip.inbox.cluster"))
        let hermes = try XCTUnwrap(screen.element("chip.inbox.hermes"))
        XCTAssertEqual(hermes.accessibilityLabel, "Hermes green")
        XCTAssertGreaterThan(hermes.accessibilityFrame.minX, cluster.accessibilityFrame.maxX)
    }

    func testEmptyInboxShowsAllClear() throws {
        let screen = try hostInbox(.inboxEmpty)
        defer { screen.close() }
        screen.assertVisible(["empty.inbox.all-clear"])
        XCTAssertNil(screen.element("section.Needs you"))
    }

    func testFailedInboxLoadShowsError() throws {
        let screen = try hostInbox(.inboxError)
        defer { screen.close() }
        screen.assertVisible(["text.inbox.error"])
    }

    func testAcknowledgeMovesAlertToHermes() async throws {
        try await assertAction(.ack, itemID: "alert-crashloop", startsIn: \.needsYou, endsIn: "Hermes is on it")
    }

    func testApproveMovesApprovalToHermes() async throws {
        try await assertAction(.approve, itemID: "approval-ingress", startsIn: \.needsYou, endsIn: "Hermes is on it")
    }

    func testUnsnoozeMovesAlertBackToNeedsYou() async throws {
        try await assertAction(.unsnooze, itemID: "alert-osdfull", startsIn: \.upcoming, endsIn: "Needs you")
    }

    private func assertAction(
        _ action: ItemActionRequest,
        itemID: String,
        startsIn source: KeyPath<ItemInbox, [Item]>,
        endsIn destination: String
    ) async throws {
        let store = UITestScenario.fixtureStore(.inboxPopulated)
        await store.refresh()
        let item = try XCTUnwrap(store.inbox?[keyPath: source].first { $0.id == itemID })
        let screen = try hostInbox(store)
        defer { screen.close() }

        await store.perform(action, on: item)

        let row = "row.item.\(itemID)"
        let section = "section.\(destination)"
        let order = destination == "Needs you"
            ? [section, row, "section.Hermes is on it"]
            : [section, row, "section.Upcoming"]
        screen.assertVisible(order)
        screen.assertVerticalOrder(order)
    }

    func testEndingMaintenanceRemovesBanner() throws {
        let screen = try hostInbox(.inboxMaintenance)
        defer { screen.close() }
        let banner = "text.maintenance.window-upgrade"
        screen.assertVisible([banner, "section.Needs you"])
        let label = try XCTUnwrap(screen.element(banner)?.accessibilityLabel)
        XCTAssertTrue(label.contains("Cluster upgrade"))
        XCTAssertTrue(label.contains("All alerts silenced"))
        screen.assertVerticalOrder([banner, "section.Needs you"])
        try screen.activate("button.maintenance.end.window-upgrade")
        screen.assertGone(banner)
    }

    func testRowsStartWithTheirSourceName() throws {
        let screen = try hostInbox(.inboxPopulated)
        defer { screen.close() }
        let sources = ["approval-ingress": "Hermes", "alert-crashloop": "Alertmanager", "factory-merge": "Factory"]
        screen.assertVisible(sources.keys.map { "row.item.\($0)" })
        for (id, name) in sources {
            let label = try XCTUnwrap(screen.element("row.item.\(id)")?.accessibilityLabel)
            XCTAssertTrue(label.hasPrefix(name), "\(id): \(label)")
        }
    }

    func testMaintenanceSheetStartsSelectedWindow() throws {
        let screen = try hostInbox(.inboxPopulated)
        defer { screen.close() }
        let wrench = "button.inbox.maintenance"
        screen.assertVisible([wrench])
        XCTAssertEqual(screen.element(wrench)?.accessibilityLabel, "Start a maintenance window")
        try screen.activate(wrench)

        screen.assertVisible(["field.maintenance.title", "picker.maintenance.length"])
        let title = try XCTUnwrap(screen.firstView(ofType: UITextField.self))
        title.insertText("Disk swap")
        let lengths = try XCTUnwrap(screen.firstView(ofType: UISegmentedControl.self))
        let halfHour = (0 ..< lengths.numberOfSegments).first { lengths.titleForSegment(at: $0) == "30m" }
        lengths.selectedSegmentIndex = try XCTUnwrap(halfHour)
        lengths.sendActions(for: .valueChanged)
        XCTAssertTrue(screen.hasLabel("Cowtail's own watchdog items still push."))
        screen.assertLabel("Start 30m window", for: "button.maintenance.start")
        try screen.activate("button.maintenance.start")
        let banner = "text.maintenance.seeded-window-1"
        screen.assertVisible([banner])
        XCTAssertTrue(screen.element(banner)?.accessibilityLabel?.contains("Disk swap") == true)
    }

    private func hostInbox(_ scenario: UITestScenario.Name) throws -> HostedScreen {
        try hostInbox(UITestScenario.fixtureStore(scenario))
    }

    private func hostInbox(_ store: CowtailStore) throws -> HostedScreen {
        try HostedScreen(NavigationStack { InboxView() }
            .environment(store)
            .environmentObject(UniversalLinkRouter.shared))
    }
}
