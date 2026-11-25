import XCTest

@MainActor
final class InboxFlowTests: XCTestCase {
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

    func testEveryNeedsYouActionButtonNamesItsAction() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let expected = [
            "button.item.approve.approval-ingress": "Approve",
            "button.item.deny.approval-ingress": "Deny",
            "button.item.reply.question-osd": "Reply",
            "button.item.ack.alert-crashloop": "Acknowledge",
            "button.item.snooze.alert-crashloop": "Snooze",
        ]
        for (identifier, label) in expected {
            let button = app.buttons[identifier]
            XCTAssertTrue(button.waitForExistence(timeout: 10), identifier)
            XCTAssertEqual(button.label, label, identifier)
        }
    }

    func testApprovingMovesTheItemOutOfNeedsYou() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let approve = app.buttons["button.item.approve.approval-ingress"]
        XCTAssertTrue(approve.waitForExistence(timeout: 10))
        approve.tap()

        let row = app.element("row.item.approval-ingress")
        let withHermes = app.element("section.Hermes is on it")
        let movedBelow = NSPredicate { _, _ in row.exists && withHermes.exists && row.frame.minY > withHermes.frame.minY }
        expectation(for: movedBelow, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons["button.item.approve.approval-ingress"].exists)
    }

    func testAPickedSnoozeMovesTheItemIntoUpcoming() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let snooze = app.buttons["button.item.snooze.alert-crashloop"]
        XCTAssertTrue(snooze.waitForExistence(timeout: 10))
        snooze.tap()
        let fourHours = app.buttons["button.snooze.4h"]
        XCTAssertTrue(fourHours.waitForExistence(timeout: 10))
        fourHours.tap()

        let row = app.element("row.item.alert-crashloop")
        let upcoming = app.element("section.Upcoming")
        let inUpcoming = NSPredicate { _, _ in
            row.exists && upcoming.exists && row.frame.minY > upcoming.frame.minY
        }
        expectation(for: inUpcoming, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.buttons["button.item.unsnooze.alert-crashloop"].exists)
    }

    func testUnsnoozeReturnsTheItemToTheInbox() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let unsnooze = app.buttons["button.item.unsnooze.alert-osdfull"]
        XCTAssertTrue(unsnooze.waitForExistence(timeout: 10))
        XCTAssertEqual(unsnooze.label, "Unsnooze")
        unsnooze.tap()

        // The seeded server returns an item that needs the owner to Needs you.
        let row = app.element("row.item.alert-osdfull")
        let withHermes = app.element("section.Hermes is on it")
        let inNeedsYou = NSPredicate { _, _ in row.exists && withHermes.exists && row.frame.minY < withHermes.frame.minY }
        expectation(for: inNeedsYou, evaluatedWith: nil)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons["button.item.unsnooze.alert-osdfull"].exists)
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
        app.assertSections(["Timeline", "Details", "Fix", "Past occurrences"])
        XCTAssertTrue(app.element("row.prior-occurrence.alert-replicas-prior-1").exists)

        // Hermes's evidence starts collapsed and opens to its numbered steps.
        let evidence = app.buttons["Evidence · 2 steps"]
        XCTAssertTrue(evidence.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["1 · Read the replica's last termination state"].exists)
        evidence.tap()
        XCTAssertTrue(app.staticTexts["1 · Read the replica's last termination state"].waitForExistence(timeout: 10))
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
