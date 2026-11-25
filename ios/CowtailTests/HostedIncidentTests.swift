import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedIncidentTests: XCTestCase {
    func testIncidentRowOpensItsDetailAndMembers() throws {
        let screen = try host()
        defer { screen.close() }
        let row = "row.incident.incident-storage"
        screen.assertVisible(["section.Needs you", row, "section.Hermes is on it"])
        screen.assertVerticalOrder(["section.Needs you", row, "section.Hermes is on it"])
        let label = try XCTUnwrap(screen.element(row)?.accessibilityLabel)
        XCTAssertTrue(label.contains("Storage outage"))
        XCTAssertTrue(label.contains("Incident · 2 items · now · 47m"))
        XCTAssertNil(screen.element("row.item.alert-osddown"))
        try screen.activate(row)
        let sections = ["section.Timeline", "section.Postmortem", "section.Members"]
        screen.assertVisible(["screen.incident-detail", "event.item_added", "button.incident.add",
                              "button.incident.postmortem", "button.incident.resolve",
                              "row.item.alert-osddown", "row.item.alert-cephhealtherr"] + sections)
        screen.assertVerticalOrder(sections)
        XCTAssertTrue(screen.element("button.incident.postmortem")?.accessibilityTraits.contains(.notEnabled) == true)
    }

    func testResolvedIncidentShowsPostmortemAndFollowUps() throws {
        let screen = try host(route: .incident("incident-media"))
        defer { screen.close() }
        screen.assertVisible(["text.incident.postmortem", "event.postmortem_written"])
        XCTAssertTrue(screen.hasLabel("Follow-ups"))
        XCTAssertTrue(screen.hasLabel("Raise the transcoder's memory limit"))
        XCTAssertNil(screen.element("button.incident.resolve"))
    }

    func testRemovingMemberUpdatesRenderedIncident() async throws {
        let store = UITestScenario.fixtureStore(.inboxIncidents)
        let id = "incident-storage"
        await store.loadIncident(id: id)
        let screen = try HostedScreen(NavigationStack { IncidentDestinationView(id: id) }.environmentObject(store))
        defer { screen.close() }
        screen.assertVisible(["row.item.alert-cephhealtherr", "row.item.alert-osddown"])
        await store.change(.remove(itemID: "alert-cephhealtherr"), incidentID: id)
        screen.assertGone("row.item.alert-cephhealtherr")
        XCTAssertNotNil(screen.element("row.item.alert-osddown"))
    }

    func testMemberShowsLinkBackToItsIncident() throws {
        let screen = try host(route: .incident("incident-storage"))
        defer { screen.close() }
        try screen.activate("row.item.alert-osddown")
        screen.assertVisible(["chip.item.incident"])
        XCTAssertEqual(screen.element("chip.item.incident")?.accessibilityLabel, "Open incident Storage outage")
    }

    private func host(route: AppRoute? = nil) throws -> HostedScreen {
        let router = UniversalLinkRouter.shared
        router.openInbox()
        if let route {
            router.inboxPath = [route]
        }
        return try HostedScreen(ContentView()
            .environmentObject(UITestScenario.fixtureStore(.inboxIncidents))
            .environmentObject(router))
    }
}
