import XCTest
@testable import CowtailKit

final class ItemPresentationTests: XCTestCase {
    func testAnUpcomingRowOffersUnsnoozeOnlyWhenTheServerDoes() {
        let snoozed = { (offered: [ItemAction]) in
            Item(
                id: "item", source: "cron", kind: .fyi, urgency: .today, state: .snoozed, title: "Disk",
                availableActions: offered, createdAt: .now
            )
        }

        XCTAssertEqual(ItemButton.buttons(for: snoozed([.ack, .unsnooze])), [.ack, .unsnooze])
        XCTAssertEqual(ItemButton.buttons(for: snoozed([.ack, .unsnooze]), isUpcoming: true), [.unsnooze])
        XCTAssertEqual(ItemButton.buttons(for: snoozed([.ack]), isUpcoming: true), [])
    }

    func testANotifiedEventNamesTheDecisionTheServerRecorded() {
        let text = { (payload: [String: String]) in
            ItemEvent(id: "event", at: .now, type: .notified, actor: "cowtail", payload: payload).text
        }

        XCTAssertEqual(text(["decision": "pushed"]), "Push sent")
        XCTAssertEqual(text(["decision": "skipped", "why": "not_open"]), "Skipped · not open")
        XCTAssertEqual(text(["decision": "held", "why": "quiet_hours"]), "Held · quiet hours")
        XCTAssertEqual(text(["decision": "batched"]), "Batched")
    }

    /// November 2026 in a fixed zone.
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    private static func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    func testAReturnTimeNamesTodayThenTheWeekdayThenTheDate() {
        let format = { (date: Date) in ItemFormat.returnTime(date, now: Self.date(23, 9, 41), calendar: Self.calendar) }

        XCTAssertEqual(format(Self.date(23, 13, 41)), "Today 13:41")
        XCTAssertEqual(format(Self.date(27, 9)), "Fri 09:00")
        XCTAssertEqual(format(Self.date(29, 21, 5)), "Sun 21:05")
        XCTAssertEqual(format(Self.date(30, 9)), "30 Nov 09:00")
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

    func testAPastOccurrenceShowsItsFixCommitShortOrADash() {
        let prior = { (commit: String?) in
            PriorOccurrence(alertID: "a", firedAt: .now, outcome: .fixed, rootCause: nil, summary: "Crash", cause: "Crash", fixCommit: commit)
        }

        XCTAssertEqual(prior("7be01d4e9").fixCommitText, "7be01d4")
        XCTAssertEqual(prior(nil).fixCommitText, "–")
    }
}
