import XCTest

@MainActor
final class InboxFlowTests: XCTestCase {
    func testInboxShowsItsThreeSectionsInTheFiguresOrder() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        app.assertSections(["Needs you", "Hermes is on it", "Handled · 24h"])
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

    func testItemDetailShowsATimelineOfEveryEventType() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.alert-replicas")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

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

        let expected = ["approval-ingress": "Hermes", "alert-crashloop": "Alertmanager", "done-deploy": "Deployer"]
        for (id, name) in expected {
            let row = app.element("row.item.\(id)")
            XCTAssertTrue(row.waitForExistence(timeout: 10), id)
            XCTAssertTrue(row.label.hasPrefix(name), "\(id): \(row.label)")
        }
    }

    func testTheItemHeaderShowsTheSourcesUploadedIcon() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.done-deploy")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        let icon = app.images["icon.source.image"]
        XCTAssertTrue(icon.waitForExistence(timeout: 10))
        XCTAssertEqual(icon.label, "Deployer")
    }

    func testTheItemHeaderFallsBackToTheSourcesSymbol() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()

        let row = app.element("row.item.alert-replicas")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        let icon = app.images["icon.source.symbol"]
        XCTAssertTrue(icon.waitForExistence(timeout: 10))
        XCTAssertEqual(icon.label, "Alertmanager")
    }
}
