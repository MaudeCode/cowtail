import XCTest
@testable import CowtailKit

final class ItemPresentationTests: XCTestCase {
    private func item(_ offered: [ItemAction], calls: [AlertHumanAction] = []) -> Item {
        Item(
            id: "item", source: "alertmanager", kind: .alert, urgency: .today, title: "Disk",
            availableActions: offered, alertActions: calls, createdAt: .now
        )
    }

    /// The item page and a row's context menu show this list; the swipes pick from it.
    func testAnItemsButtonsAreExactlyTheServersActionsThenItsAlertCalls() {
        let url = URL(string: "https://grafana.example/d/disk")!
        let script = RunbookScript(id: "prune", name: "Prune images")
        let offered = item([.ack, .snooze, .open(url), .choose(["Rebalance now", "Wait"]), .run(script)], calls: [.retryInvestigation, .markNoise])

        let buttons = ItemButton.buttons(for: offered)

        XCTAssertEqual(
            buttons,
            [.ack, .snooze, .open(url), .choose("Rebalance now"), .choose("Wait"), .run(script), .retryInvestigation, .markNoise]
        )
        XCTAssertEqual(ItemButton.trailingSwipe(buttons), [.ack, .snooze])
        XCTAssertEqual(ItemButton.leadingSwipe(buttons), [])
    }

    func testWithoutAcknowledgeTheTrailingSwipeLeadsWithSnooze() {
        let buttons = ItemButton.buttons(for: item([.approve, .deny, .snooze]))

        XCTAssertEqual(ItemButton.trailingSwipe(buttons), [.snooze])
        XCTAssertEqual(ItemButton.leadingSwipe(buttons), [.approve])
    }

    func testUnsnoozeSwipesOnlyWhenTheServerListsIt() {
        XCTAssertEqual(ItemButton.leadingSwipe(ItemButton.buttons(for: item([.ack, .snooze, .unsnooze]))), [.unsnooze])
        XCTAssertEqual(ItemButton.leadingSwipe(ItemButton.buttons(for: item([.ack, .snooze]))), [])
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
