import XCTest
@testable import Cowtail

final class AlertPresentationHelpersTests: XCTestCase {
    func testSourceLineUsesBulletSeparator() {
        let alert = AlertItem(
            id: "a1",
            timestamp: .now,
            alertName: "CephHealthWarning",
            severity: .critical,
            namespace: "rook-ceph",
            node: "node-a",
            outcome: .escalated,
            summary: "summary",
            rootCause: "",
            actionTaken: "",
            status: .firing,
            resolvedAt: nil,
            messaged: false
        )

        XCTAssertEqual(alert.sourceLine, "rook-ceph • node-a")
    }

    func testOutcomeEmphasisPrefersOutcomeBadgeOverSeverity() {
        XCTAssertTrue(AlertOutcome.escalated.prefersStrongBadge)
        XCTAssertFalse(AlertSeverity.warning.prefersStrongBadge)
    }
}
