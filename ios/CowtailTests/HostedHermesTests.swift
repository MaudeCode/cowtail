import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedHermesTests: XCTestCase {
    func testHermesShowsItsHeaderAndOrdersSections() throws {
        let screen = try HostedScreen(NavigationStack { HermesView() }
            .environmentObject(UITestScenario.fixtureStore(.inboxPopulated)))
        defer { screen.close() }

        let sections = [
            "Platforms", "Cron", "Cron incidents", "Kanban", "Budget",
            "Runbook · services", "Runbook · diagnostics", "Run · Restart script runner", "Recent answers",
        ].map { "section.\($0)" }
        let ordered = ["text.hermes.model"] + sections
        screen.assertVisible(["chip.hermes.heartbeat"] + ordered)
        XCTAssertEqual(screen.element("text.hermes.model")?.accessibilityLabel, "opus-5.5 · anthropic")
        screen.assertVerticalOrder(ordered)
    }

    func testConfirmingRunbookPromptShowsOutput() throws {
        let screen = try HostedScreen(NavigationStack { HermesView() }
            .environmentObject(UITestScenario.fixtureStore(.inboxPopulated)))
        defer { screen.close() }
        screen.assertVisible(["button.runbook.gateway-restart"])
        XCTAssertTrue(screen.hasLabel("Asks to confirm"))
        try screen.activate("button.runbook.gateway-restart")
        try screen.confirmAlert(title: "Restart Hermes gateway", message: "Restart the Hermes gateway?", action: "Run")
        screen.assertVisible(["section.Run · Restart Hermes gateway", "text.run.output", "row.hermes.run.run-3"])
        XCTAssertTrue(screen.element("text.run.output")?.accessibilityLabel?.contains("/dev/nvme0n1p2  916G") == true)
    }

    func testCronIncidentOpensItsItem() throws {
        let router = UniversalLinkRouter.shared
        router.openInbox()
        router.selectedTab = .hermes
        defer { router.openInbox() }
        let screen = try HostedScreen(ContentView()
            .environmentObject(UITestScenario.fixtureStore(.inboxPopulated))
            .environmentObject(router))
        defer { screen.close() }
        try screen.activate("row.hermes.incident.backup-verify-sig")
        screen.assertVisible(["screen.item-detail", "text.item.title"])
        XCTAssertEqual(screen.element("text.item.title")?.accessibilityLabel, "Nightly backup verify failed")
    }
}
