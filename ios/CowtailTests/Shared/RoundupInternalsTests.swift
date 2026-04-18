import XCTest
import UIKit
import SwiftUI
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

    func testRoundupURLRoutesIntoRoundupTabAndParsesDateRange() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/roundup?from=2026-04-10&to=2026-04-11"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .roundup)
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-10", to: "2026-04-11"))
    }

    func testRoundupURLFallsBackMissingToDateFromFromDate() throws {
        let handled = try XCTUnwrap(URL(string: "\(AppConfig.publicSiteURL.absoluteString)/roundup?from=2026-04-12"))
        let router = UniversalLinkRouter.shared

        XCTAssertTrue(router.handle(handled))
        XCTAssertEqual(router.selectedTab, .roundup)
        XCTAssertEqual(router.roundupRoute, RoundupRoute(from: "2026-04-12", to: "2026-04-12"))
    }

    func testRoundupViewUsesInjectedRoundupDataClientAndSeededRoundupData() async throws {
        let seed = UITestScenario(named: .inboxPopulated).seed
        let view = RoundupView(roundupRoute: RoundupRoute(from: "2026-04-14", to: "2026-04-14"))
        XCTAssertFalse(Mirror(reflecting: view).children.compactMap(\.label).contains("api"))

        let client = RoundupDataClientSpy(
            alerts: seed.roundupAlerts,
            fixes: seed.roundupFixes
        )
        let host = UIHostingController(
            rootView: RoundupHost(
                roundupRoute: RoundupRoute(from: "2026-04-14", to: "2026-04-14"),
                client: client
            )
        )
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = host
        window.isHidden = false

        host.beginAppearanceTransition(true, animated: false)
        host.endAppearanceTransition()

        await client.waitUntilLoaded()

        let snapshot = await client.snapshot()
        XCTAssertEqual(snapshot.alertRequestCount, 1)
        XCTAssertEqual(snapshot.fixRequestCount, 1)
        XCTAssertEqual(snapshot.lastAlerts.map(\.id), seed.roundupAlerts.map(\.id))
        XCTAssertEqual(snapshot.lastFixes.map(\.id), seed.roundupFixes.map(\.id))

        window.isHidden = true
    }
}

private struct RoundupHost: View {
    let roundupRoute: RoundupRoute
    let client: any RoundupDataClient

    var body: some View {
        RoundupView(roundupRoute: roundupRoute)
            .environment(\.roundupDataClient, client)
    }
}

private actor RoundupDataClientSpy: RoundupDataClient {
    private let alerts: [AlertItem]
    private let fixes: [AlertFix]
    private var alertRequestCountStorage = 0
    private var fixRequestCountStorage = 0
    private var lastAlertsStorage: [AlertItem] = []
    private var lastFixesStorage: [AlertFix] = []
    private var loadContinuation: CheckedContinuation<Void, Never>?

    init(alerts: [AlertItem], fixes: [AlertFix]) {
        self.alerts = alerts
        self.fixes = fixes
    }

    func fetchRoundupAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        alertRequestCountStorage += 1
        lastAlertsStorage = alerts
        signalLoaded()
        return alerts
    }

    func fetchRoundupFixes(from: Date, to: Date) async throws -> [AlertFix] {
        fixRequestCountStorage += 1
        lastFixesStorage = fixes
        signalLoaded()
        return fixes
    }

    func waitUntilLoaded() async {
        if alertRequestCountStorage > 0 && fixRequestCountStorage > 0 {
            return
        }

        await withCheckedContinuation { continuation in
            loadContinuation = continuation
        }
    }

    func signalLoaded() {
        guard alertRequestCountStorage > 0 && fixRequestCountStorage > 0 else {
            return
        }

        loadContinuation?.resume()
        loadContinuation = nil
    }

    func snapshot() -> Snapshot {
        Snapshot(
            alertRequestCount: alertRequestCountStorage,
            fixRequestCount: fixRequestCountStorage,
            lastAlerts: lastAlertsStorage,
            lastFixes: lastFixesStorage
        )
    }

    struct Snapshot {
        let alertRequestCount: Int
        let fixRequestCount: Int
        let lastAlerts: [AlertItem]
        let lastFixes: [AlertFix]
    }
}
