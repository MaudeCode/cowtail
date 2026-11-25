import SwiftUI
import XCTest
@testable import Cowtail

@MainActor
final class HostedClusterTests: XCTestCase {
    func testClusterShowsPipelineStateAndOrdersSections() throws {
        let store = UITestScenario.fixtureStore(.inboxPopulated)

        let screen = try HostedScreen(NavigationStack { ClusterView() }.environmentObject(store))
        defer { screen.close() }
        let sections = ["Nodes", "Ceph", "Firing by namespace", "Volume · 7 days", "Noisiest"].map { "section.\($0)" }
        screen.assertVisible(["chip.cluster.pipeline", "text.cluster.last-watchdog", "chart.cluster.volume"] + sections)
        screen.assertVerticalOrder(sections)
    }
}
