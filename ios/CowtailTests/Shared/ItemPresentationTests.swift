import XCTest
@testable import Cowtail

final class ItemPresentationTests: XCTestCase {
    func testANotifiedEventNamesTheDecisionTheServerRecorded() {
        let text = { (payload: [String: String]) in
            ItemEvent(id: "event", at: .now, type: .notified, actor: "cowtail", payload: payload).text
        }

        XCTAssertEqual(text(["decision": "pushed"]), "Push sent")
        XCTAssertEqual(text(["decision": "skipped", "why": "not_open"]), "Skipped · not open")
        XCTAssertEqual(text(["decision": "held", "why": "quiet_hours"]), "Held · quiet hours")
        XCTAssertEqual(text(["decision": "batched"]), "Batched")
    }

    func testEvidenceNumbersEachStepAndJoinsItsCommandAndOutput() {
        let steps = [
            EvidenceStep(step: "Read logs", command: "kubectl logs api", output: "OOMKilled"),
            EvidenceStep(step: "Check the limit", output: "512Mi"),
            EvidenceStep(step: "Raise the limit"),
        ]
        let event = ItemEvent(id: "event", at: .now, type: .hermesUpdate, actor: "hermes", payload: [:], evidence: steps)

        XCTAssertEqual(event.evidenceTitle, "Evidence · 3 steps")
        XCTAssertEqual(steps[0].line(1), "1 · Read logs")
        XCTAssertEqual(steps.map(\.block), ["$ kubectl logs api\nOOMKilled", "512Mi", nil])
    }

    func testAPastOccurrenceShowsTheFirstFixCommitShortOrADash() {
        let fix = { (commit: String?) in PriorOccurrence.Fix(description: "Fix", rootCause: "Cause", commit: commit) }
        let prior = { (fixes: [PriorOccurrence.Fix]) in
            PriorOccurrence(alertID: "a", firedAt: .now, outcome: .fixed, rootCause: nil, summary: "Crash loop", fixes: fixes)
        }

        XCTAssertEqual(prior([fix(nil), fix("7be01d4e9")]).fixCommit, "7be01d4")
        XCTAssertEqual(prior([fix(nil)]).fixCommit, "–")
        XCTAssertEqual(prior([]).cause, "Crash loop")
    }
}
