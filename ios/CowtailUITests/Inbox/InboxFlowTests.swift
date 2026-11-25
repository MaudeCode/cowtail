import XCTest

@MainActor
final class InboxFlowTests: XCTestCase {
    func testSelectingAnItemKeepsTheInboxBesideItsDetail() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        let title = app.element("text.item.title")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "KubePodCrashLooping")
        XCTAssertTrue(row.isHittable, "The inbox row must remain visible beside its detail")
        XCTAssertLessThan(row.frame.maxX, title.frame.minX)
    }

    func testInboxShowsItsThreeSectionsInTheFiguresOrder() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        app.assertSections(["Needs you", "Hermes is on it", "Upcoming"])
    }

    func testTheHeaderShowsTheHermesDotBesideTheClusterDot() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let hermes = app.element("chip.inbox.hermes")
        XCTAssertTrue(hermes.waitForExistence(timeout: 10))
        XCTAssertEqual(hermes.label, "Hermes green")
        XCTAssertGreaterThan(hermes.frame.minX, app.element("chip.inbox.cluster").frame.maxX)
    }

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

    func testWithNothingThatNeedsTheOwnerTheInboxIsAllClear() {
        let app = AppLaunching.configuredApp(scenario: "inbox_empty")
        app.launch()

        XCTAssertTrue(app.element("empty.inbox.all-clear").waitForExistence(timeout: 10))
        XCTAssertFalse(app.element("section.Needs you").exists)
    }

    func testItemDetailShowsATimelineOfEveryEventType() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "history")
        app.launch()

        app.openFromHistory("row.item.alert-replicas", searching: "Replicas")

        XCTAssertTrue(app.element("screen.item-detail").waitForExistence(timeout: 10))
        let types = [
            "created", "repeated", "dispatched", "hermes_update",
            "notified", "action_taken", "state_changed", "resolved",
        ]
        for type in types {
            XCTAssertTrue(app.element("event.\(type)").waitForExistence(timeout: 10), type)
        }
        // Answer first: the details and fix lead, before the timeline.
        app.assertSections(["Details", "Fix", "Timeline", "Past occurrences"])
        XCTAssertTrue(app.element("row.prior-occurrence.alert-replicas-prior-1").exists)

        // Hermes's evidence starts collapsed and opens to its numbered steps.
        let evidence = app.buttons["Evidence · 2 steps"]
        XCTAssertTrue(evidence.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["1 · Read the replica's last termination state"].exists)
        evidence.tap()
        XCTAssertTrue(app.staticTexts["1 · Read the replica's last termination state"].waitForExistence(timeout: 10))
    }

    func testItemActionsSitInTheirPinnedAreaNotTheBadgeRow() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()
        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        let area = app.element("area.item.actions")
        XCTAssertTrue(area.waitForExistence(timeout: 10))
        for action in ["ack", "snooze", "retry", "mark-noise", "escalate"] {
            XCTAssertTrue(area.buttons["button.item.\(action).alert-crashloop"].exists, action)
        }
        // Pinned above the tab bar.
        XCTAssertLessThanOrEqual(
            area.buttons["button.item.ack.alert-crashloop"].frame.maxY,
            app.tabBars.firstMatch.frame.minY
        )
    }

    func testAnAlertLinkOpensThatAlertsItem() {
        let app = AppLaunching.configuredApp(scenario: "alert_deep_link_known", deepLinkURL: "/alerts/alert-1")
        app.launch()

        XCTAssertTrue(app.element("screen.item-detail").waitForExistence(timeout: 10))
        XCTAssertEqual(app.element("text.item.title").label, "KubePodCrashLooping")
        // The alert's page on Cowtail Web stays one tap away.
        XCTAssertTrue(app.links["Cowtail Web"].waitForExistence(timeout: 10))
    }

    func testAnUnknownAlertLinkSaysSo() {
        let app = AppLaunching.configuredApp(scenario: "alert_deep_link_missing", deepLinkURL: "/alerts/missing-alert")
        app.launch()

        XCTAssertTrue(app.element("screen.item-missing").waitForExistence(timeout: 10))
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

    func testAFailedLoadShowsTheError() {
        let app = AppLaunching.configuredApp(scenario: "inbox_error")
        app.launch()

        XCTAssertTrue(app.element("text.inbox.error").waitForExistence(timeout: 10))
    }

    func testEveryRowStartsWithItsSourcesName() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let expected = ["approval-ingress": "Hermes", "alert-crashloop": "Alertmanager", "factory-merge": "Factory"]
        for (id, name) in expected {
            let row = app.element("row.item.\(id)")
            XCTAssertTrue(row.waitForExistence(timeout: 10), id)
            XCTAssertTrue(row.label.hasPrefix(name), "\(id): \(row.label)")
        }
    }

    func testTheItemHeaderShowsTheSourcesUploadedIcon() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "history")
        app.launch()

        app.openFromHistory("row.item.done-deploy", searching: "deployed")

        let icon = app.images["icon.source.image"]
        XCTAssertTrue(icon.waitForExistence(timeout: 10))
        XCTAssertEqual(icon.label, "Deployer")
    }

    func testTheItemHeaderFallsBackToTheSourcesSymbol() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated", startTab: "history")
        app.launch()

        app.openFromHistory("row.item.alert-replicas", searching: "Replicas")

        let icon = app.images["icon.source.symbol"]
        XCTAssertTrue(icon.waitForExistence(timeout: 10))
        XCTAssertEqual(icon.label, "Alertmanager")
    }

    func testARunningWindowsBannerSitsAboveNeedsYouUntilEndWindow() {
        let app = AppLaunching.configuredApp(scenario: "inbox_maintenance")
        app.launch()

        let banner = app.element("text.maintenance.window-upgrade")
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.contains("Cluster upgrade"), banner.label)
        XCTAssertTrue(banner.label.contains("All alerts silenced"), banner.label)
        XCTAssertLessThan(banner.frame.maxY, app.element("section.Needs you").frame.minY)

        app.buttons["button.maintenance.end.window-upgrade"].tap()

        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: banner)
        waitForExpectations(timeout: 10)
    }

    func testTheWrenchStartsAWindowFromTheSheet() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let wrench = app.buttons["button.inbox.maintenance"]
        XCTAssertTrue(wrench.waitForExistence(timeout: 10))
        XCTAssertEqual(wrench.label, "Start a maintenance window")
        wrench.tap()

        let title = app.textFields["field.maintenance.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        title.tap()
        title.typeText("Disk swap")
        app.segmentedControls.buttons["30m"].tap()
        XCTAssertTrue(app.staticTexts["Cowtail's own watchdog items still push."].exists)
        let start = app.buttons["button.maintenance.start"]
        XCTAssertEqual(start.label, "Start 30m window")
        start.tap()

        let banner = app.element("text.maintenance.seeded-window-1")
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.contains("Disk swap"), banner.label)
    }
}
