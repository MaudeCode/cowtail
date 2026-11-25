import XCTest

@MainActor
final class InboxFlowTests: XCTestCase {
    func testALongPressShowsTheItemsActionsThenItsAlertCalls() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.press(forDuration: 1.2)

        let labels = ["Acknowledge", "Snooze", "Retry investigation", "Mark as noise", "Escalate"]
        let tops = labels.map { label -> CGFloat in
            let button = app.buttons[label]
            XCTAssertTrue(button.waitForExistence(timeout: 10), label)
            return button.frame.minY
        }
        XCTAssertEqual(tops, tops.sorted(), "menu out of order")
        // A menu over the inbox, not the item page's action area, which has the same names.
        XCTAssertFalse(app.element("screen.item-detail").exists)
    }

    func testAFullTrailingSwipeAcknowledgesTheItem() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.fullSwipe(row)

        // Acknowledged, it no longer needs the owner.
        let withHermes = app.element("section.Hermes is on it")
        let movedBelow = NSPredicate { _, _ in row.exists && withHermes.exists && row.frame.minY > withHermes.frame.minY }
        expectation(for: movedBelow, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
    }

    func testAFullTrailingSwipeOnAnApprovalTakesNoAction() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.approval-ingress")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.fullSwipe(row)

        // The swipe stops on Snooze, which opens nothing until it is tapped.
        XCTAssertTrue(app.buttons["button.item.snooze.approval-ingress"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["button.snooze.4h"].exists)
        XCTAssertTrue(row.exists)
    }

    func testALeadingSwipeApprovesAndMovesTheItemOutOfNeedsYou() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.approval-ingress")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.revealSwipeActions(on: row, toward: .leading)
        let approve = app.buttons["button.item.approve.approval-ingress"]
        XCTAssertTrue(approve.waitForExistence(timeout: 10))
        XCTAssertEqual(approve.label, "Approve")
        approve.tap()

        let withHermes = app.element("section.Hermes is on it")
        let movedBelow = NSPredicate { _, _ in row.exists && withHermes.exists && row.frame.minY > withHermes.frame.minY }
        expectation(for: movedBelow, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
    }

    func testAPickedSnoozeMovesTheItemIntoUpcoming() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.revealSwipeActions(on: row, toward: .trailing)
        let snooze = app.buttons["button.item.snooze.alert-crashloop"]
        XCTAssertTrue(snooze.waitForExistence(timeout: 10))
        snooze.tap()
        let fourHours = app.buttons["button.snooze.4h"]
        XCTAssertTrue(fourHours.waitForExistence(timeout: 10))
        fourHours.tap()

        let upcoming = app.element("section.Upcoming")
        let inUpcoming = NSPredicate { _, _ in
            row.exists && upcoming.exists && row.frame.minY > upcoming.frame.minY
        }
        expectation(for: inUpcoming, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
    }

    func testALeadingSwipeUnsnoozesTheItemBackToTheInbox() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        XCTAssertTrue(app.element("section.Needs you").waitForExistence(timeout: 10))
        let row = app.scrolledTo("row.item.alert-osdfull")
        XCTAssertTrue(row.exists)
        app.revealSwipeActions(on: row, toward: .leading)
        let unsnooze = app.buttons["button.item.unsnooze.alert-osdfull"]
        XCTAssertTrue(unsnooze.waitForExistence(timeout: 10))
        XCTAssertEqual(unsnooze.label, "Unsnooze")
        unsnooze.tap()

        // The seeded server returns an item that needs the owner to Needs you.
        let withHermes = app.element("section.Hermes is on it")
        let inNeedsYou = NSPredicate { _, _ in row.exists && withHermes.exists && row.frame.minY < withHermes.frame.minY }
        expectation(for: inNeedsYou, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
    }

    func testColdOfflineLaunchShowsCachedInboxAndRetry() {
        let app = AppLaunching.configuredApp(scenario: "inbox_cached_offline")
        app.launch()

        XCTAssertTrue(app.element("text.stale.as-of").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("row.item.approval-ingress").exists)
        XCTAssertTrue(app.buttons["button.stale.retry"].exists)
        XCTAssertFalse(app.element("empty.inbox.all-clear").exists)

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Inbox restored offline"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
