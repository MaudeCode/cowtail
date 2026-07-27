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

    func testWorkflowStateSeparatesInvestigationFromSourceLifecycle() {
        XCTAssertEqual(CowtailPreviewFixtures.alert.workflowState, .investigationFailed)

        let retried = CowtailPreviewFixtures.alert.applying(
            action: .retryInvestigation,
            note: "Credentials corrected.",
            now: Date(timeIntervalSince1970: 100)
        )

        XCTAssertEqual(retried.workflowState, .queued)
        XCTAssertEqual(retried.status, .firing)
        XCTAssertEqual(retried.outcome, .pending)
        XCTAssertNil(retried.ownerDisposition)
        XCTAssertEqual(retried.investigation?.status, .queued)
        XCTAssertEqual(retried.investigation?.attempts, 0)
        XCTAssertEqual(retried.investigation?.lastError, "")
        XCTAssertEqual(retried.investigation?.lastErrorPhase, "")
    }

    func testOwnerClassificationRemainsASeparateDecision() {
        let classified = CowtailPreviewFixtures.alert.applying(
            action: .markNoise,
            note: "Expected during maintenance.",
            now: Date(timeIntervalSince1970: 100)
        )

        XCTAssertEqual(classified.workflowState, .classifiedNoise)
        XCTAssertEqual(classified.status, .firing)
        XCTAssertEqual(classified.ownerDisposition, .noise)
        XCTAssertEqual(classified.ownerNote, "Expected during maintenance.")
        XCTAssertEqual(classified.investigation?.status, .done)
    }

    func testResolvedFixedAlertUsesFixedWorkflowState() {
        XCTAssertEqual(makeAlert(status: .resolved, outcome: .fixed).workflowState, .fixed)
    }

    func testSourceRecoverySupersedesAStaleInvestigationFailure() {
        XCTAssertEqual(
            makeAlert(
                status: .resolved,
                outcome: .selfResolved,
                investigation: CowtailPreviewFixtures.alert.investigation
            ).workflowState,
            .recovered
        )
    }

    func testActionNoteLimitMatchesProtocolContract() {
        XCTAssertEqual(AlertHumanAction.noteCharacterLimit, 500)
    }

    private func makeAlert(
        status: AlertLifecycleStatus,
        outcome: AlertOutcome,
        investigation: AlertInvestigation? = nil
    ) -> AlertItem {
        AlertItem(
            id: "workflow-test",
            timestamp: .now,
            alertName: "WorkflowTest",
            severity: .warning,
            namespace: "tests",
            node: "",
            outcome: outcome,
            summary: "Workflow precedence",
            rootCause: "",
            actionTaken: "Recorded.",
            status: status,
            resolvedAt: status == .resolved ? .now : nil,
            messaged: false,
            investigation: investigation
        )
    }
}
