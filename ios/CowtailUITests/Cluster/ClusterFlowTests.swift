import XCTest

@MainActor
final class ClusterFlowTests: XCTestCase {
    func testClusterShowsPipelineStateAndItsSectionsInTheFiguresOrder() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "cluster")
        app.launch()

        XCTAssertTrue(app.element("chip.cluster.pipeline").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("text.cluster.last-watchdog").exists)
        XCTAssertTrue(app.element("chart.cluster.volume").exists)
        app.assertSections(["Nodes", "Ceph", "Firing by namespace", "Volume · 7 days", "Noisiest"])
    }
}
