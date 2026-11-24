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

    /// Monday 23 November 2026, 09:41, in a fixed zone.
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    private static func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    private static func presets(now: Date) -> [String: Date] {
        Dictionary(uniqueKeysWithValues: SnoozePreset.presets(now: now, calendar: calendar).map { ($0.title, $0.until) })
    }

    func testOnAMondayTheSnoozePresetsRunToTheFollowingMonday() {
        let presets = SnoozePreset.presets(now: Self.date(23, 9, 41), calendar: Self.calendar)

        XCTAssertEqual(presets.map(\.title), ["1 hour", "4 hours", "Tomorrow", "Next Monday"])
        XCTAssertEqual(
            presets.map(\.until),
            [Self.date(23, 10, 41), Self.date(23, 13, 41), Self.date(24, 9), Self.date(30, 9)]
        )
    }

    func testOnASundayTomorrowAndNextMondayAreTheSameMorning() {
        let presets = Self.presets(now: Self.date(29, 20))

        XCTAssertEqual(presets["Tomorrow"], Self.date(30, 9))
        XCTAssertEqual(presets["Next Monday"], Self.date(30, 9))
    }

    func testAReturnTimeNamesTodayThenTheWeekdayThenTheDate() {
        let format = { (date: Date) in ItemFormat.returnTime(date, now: Self.date(23, 9, 41), calendar: Self.calendar) }

        XCTAssertEqual(format(Self.date(23, 13, 41)), "Today 13:41")
        XCTAssertEqual(format(Self.date(27, 9)), "Fri 09:00")
        XCTAssertEqual(format(Self.date(29, 21, 5)), "Sun 21:05")
        XCTAssertEqual(format(Self.date(30, 9)), "30 Nov 09:00")
    }
}
