import XCTest

@MainActor
final class OpenClawFlowTests: XCTestCase {
    func testOpenClawTabShowsSeededDisplayNameAndThreads() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.threads").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["row.openclaw.thread.preview-thread"].waitForExistence(timeout: 5))
    }

    func testCanOpenThreadDetail() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))
        let threadTitle = element(in: app, identifier: "title.openclaw.thread")
        XCTAssertTrue(threadTitle.waitForExistence(timeout: 5))
        XCTAssertTrue(threadTitle.label.contains("Investigate storage latency"))
    }

    func testCanFocusAndTypeInThreadComposer() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        let composer = element(in: app, identifier: "field.openclaw.reply")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))

        composer.tap()
        composer.typeText("Check rollout")

        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["button.openclaw.send-reply"].isEnabled)

        element(in: app, identifier: "message.openclaw.preview-message").tap()

        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 2))
    }

    func testNewThreadRoutesToCreatedConversation() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.threads").waitForExistence(timeout: 5))

        app.buttons["button.openclaw.new-thread"].tap()
        XCTAssertTrue(element(in: app, identifier: "sheet.openclaw.new-thread").waitForExistence(timeout: 5))

        let titleField = element(in: app, identifier: "field.openclaw.new-thread.title")
        XCTAssertTrue(titleField.waitForExistence(timeout: 5))
        titleField.tap()
        titleField.typeText("Seeded route check")

        let messageField = element(in: app, identifier: "field.openclaw.new-thread.message")
        XCTAssertTrue(messageField.waitForExistence(timeout: 5))
        messageField.tap()
        messageField.typeText("Start from iOS")

        app.buttons["button.openclaw.new-thread.send"].tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))
        XCTAssertTrue(element(in: app, identifier: "title.openclaw.thread").label.contains("Seeded route check"))
        XCTAssertTrue(staticText(containing: "Start from iOS", in: app).waitForExistence(timeout: 5))
    }

    func testBackFromThreadDetailReturnsToThreadList() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let firstThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        let secondThreadRow = app.buttons["row.openclaw.thread.preview-thread-2"]
        XCTAssertTrue(firstThreadRow.waitForExistence(timeout: 5))
        XCTAssertTrue(secondThreadRow.waitForExistence(timeout: 5))

        firstThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        app.navigationBars.buttons.element(boundBy: 0).tap()

        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.threads").waitForExistence(timeout: 5))
        XCTAssertTrue(firstThreadRow.waitForExistence(timeout: 5))
        XCTAssertTrue(secondThreadRow.waitForExistence(timeout: 5))
        XCTAssertFalse(element(in: app, identifier: "screen.openclaw.thread-detail").exists)
    }

    func testThreadDetailExposesRenameAndDeleteActions() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        app.buttons["button.openclaw.thread-actions"].tap()

        XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Delete"].exists)
    }

    func testThreadListDeleteConfirmationCanConfirmSelectedRow() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        XCUIDevice.shared.orientation = .portrait
        addTeardownBlock {
            XCUIDevice.shared.orientation = .portrait
        }
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))

        openDeleteConfirmation(for: previewThreadRow, in: app)
        XCTAssertTrue(app.alerts["Delete Thread"].waitForExistence(timeout: 5))
        let confirmButton = app.buttons["button.openclaw.thread-delete.confirm.preview-thread"].firstMatch
        XCTAssertTrue(confirmButton.waitForExistence(timeout: 5))
        XCTAssertTrue(previewThreadRow.exists)
        confirmButton.tap()

        XCTAssertFalse(previewThreadRow.waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["row.openclaw.thread.preview-thread-2"].exists)
    }

    func testThreadListDeleteConfirmationUsesCenteredAlertInLandscape() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        XCUIDevice.shared.orientation = .landscapeLeft
        addTeardownBlock {
            XCUIDevice.shared.orientation = .portrait
        }
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))

        openDeleteConfirmation(for: previewThreadRow, in: app)
        XCTAssertTrue(app.alerts["Delete Thread"].waitForExistence(timeout: 5))
        let confirmButton = app.buttons["button.openclaw.thread-delete.confirm.preview-thread"].firstMatch
        XCTAssertTrue(confirmButton.waitForExistence(timeout: 5))
    }

    func testThreadDetailShowsExpandableToolCalls() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_populated")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let previewThreadRow = app.buttons["row.openclaw.thread.preview-thread"]
        XCTAssertTrue(previewThreadRow.waitForExistence(timeout: 5))
        previewThreadRow.tap()
        XCTAssertTrue(element(in: app, identifier: "screen.openclaw.thread-detail").waitForExistence(timeout: 5))

        let toolCall = app.buttons["Tool call query_metrics"].firstMatch
        XCTAssertTrue(toolCall.waitForExistence(timeout: 5))
        toolCall.tap()

        XCTAssertTrue(app.staticTexts["Input"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Output"].exists)
        XCTAssertTrue(app.staticTexts["p95 latency is elevated on node-a and node-c."].exists)
    }

    func testTranscriptShowcaseRendersMessageSequenceAndActions() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_transcript_showcase")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let row = app.buttons["row.openclaw.thread.preview-transcript-thread"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()

        let assistantMessage = element(in: app, identifier: "message.openclaw.message-transcript-assistant")
        let userMessage = element(in: app, identifier: "message.openclaw.message-transcript-user")
        let runningToolMessage = element(in: app, identifier: "message.openclaw.message-transcript-running-tool")
        let errorToolMessage = element(in: app, identifier: "message.openclaw.message-transcript-error-tool")

        XCTAssertTrue(assistantMessage.waitForExistence(timeout: 5))
        XCTAssertTrue(userMessage.exists)
        XCTAssertTrue(runningToolMessage.exists)
        XCTAssertTrue(errorToolMessage.exists)
        XCTAssertLessThan(assistantMessage.frame.minY, userMessage.frame.minY)
        XCTAssertLessThan(userMessage.frame.minY, runningToolMessage.frame.minY)
        XCTAssertLessThan(runningToolMessage.frame.minY, errorToolMessage.frame.minY)
        XCTAssertTrue(staticText(containing: "I checked the storage latency window", in: app).exists)
        XCTAssertTrue(staticText(containing: "Keep watching it", in: app).exists)
        XCTAssertTrue(staticText(containing: "read-only follow-up check", in: app).exists)
        XCTAssertTrue(staticText(containing: "One read-only query failed", in: app).exists)
        XCTAssertTrue(app.buttons["button.openclaw.action.preview-transcript-action"].waitForExistence(timeout: 5))
    }

    func testThreadDetailPausesAutoscrollUntilScrollToBottomButtonIsTapped() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_autoscroll")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let row = app.buttons["row.openclaw.thread.preview-autoscroll-thread"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()

        let lastSeededMessage = element(in: app, identifier: "message.openclaw.message-autoscroll-24")
        XCTAssertTrue(lastSeededMessage.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["button.openclaw.scroll-to-bottom"].exists)

        dragTranscriptTowardOlderMessages(in: app)
        let scrollToBottomButton = app.buttons["button.openclaw.scroll-to-bottom"]
        XCTAssertTrue(scrollToBottomButton.waitForExistence(timeout: 5))

        let composer = element(in: app, identifier: "field.openclaw.reply")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("new pinned-scroll check")
        app.buttons["button.openclaw.send-reply"].tap()

        let realtimeReply = staticText(containing: "Seeded OpenClaw response: new pinned-scroll check", in: app)
        XCTAssertFalse(realtimeReply.waitForExistence(timeout: 2))
        XCTAssertTrue(scrollToBottomButton.waitForExistence(timeout: 5))

        scrollToBottomButton.tap()
        XCTAssertTrue(realtimeReply.waitForExistence(timeout: 5))
    }

    func testThreadDetailKeepsBottomVisibleWhenComposerFocuses() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_autoscroll")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let row = app.buttons["row.openclaw.thread.preview-autoscroll-thread"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()

        let lastSeededMessage = element(in: app, identifier: "message.openclaw.message-autoscroll-24")
        XCTAssertTrue(lastSeededMessage.waitForExistence(timeout: 5))

        let composer = element(in: app, identifier: "field.openclaw.reply")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))

        XCTAssertLessThan(lastSeededMessage.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertFalse(app.buttons["button.openclaw.scroll-to-bottom"].exists)
    }

    func testTranscriptToolCardsExposeStableExpandableDetails() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_transcript_showcase")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let row = app.buttons["row.openclaw.thread.preview-transcript-thread"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()

        let completeTool = app.buttons["tool.openclaw.tool-transcript-complete"].firstMatch
        XCTAssertTrue(completeTool.waitForExistence(timeout: 5))
        XCTAssertTrue(completeTool.value as? String == "Complete, collapsed")
        completeTool.tap()
        XCTAssertTrue(completeTool.value as? String == "Complete, expanded")
        XCTAssertTrue(element(in: app, identifier: "tool.openclaw.tool-transcript-complete.input").waitForExistence(timeout: 5))
        XCTAssertTrue(element(in: app, identifier: "tool.openclaw.tool-transcript-complete.output").exists)
        XCTAssertTrue(staticText(containing: "storage_latency_p95", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(staticText(containing: "p95 latency peaked at 184ms", in: app).exists)

        let errorTool = app.buttons["tool.openclaw.tool-transcript-error"].firstMatch
        XCTAssertTrue(errorTool.waitForExistence(timeout: 5))
        XCTAssertTrue(errorTool.value as? String == "Error, collapsed")
    }

    func testComposerRemainsUsableAfterTranscriptShowcaseContent() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_transcript_showcase")
        app.launch()

        app.tabBars.buttons["Maude"].tap()
        let row = app.buttons["row.openclaw.thread.preview-transcript-thread"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()

        let composer = element(in: app, identifier: "field.openclaw.reply")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Keep monitoring")

        XCTAssertTrue(app.buttons["button.openclaw.send-reply"].isEnabled)
    }

    func testEmptyStateAppears() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_empty")
        app.launch()

        app.tabBars.buttons["Maude"].tap()

        XCTAssertTrue(element(in: app, identifier: "card.openclaw.empty").waitForExistence(timeout: 5))
    }

    func testSignedOutStateAppears() {
        let app = AppLaunching.configuredApp(scenario: "openclaw_signed_out")
        app.launch()

        app.tabBars.buttons["OpenClaw"].tap()

        XCTAssertTrue(element(in: app, identifier: "card.openclaw.signed-out").waitForExistence(timeout: 5))
    }

    private func element(in app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func staticText(containing text: String, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func openDeleteConfirmation(for row: XCUIElement, in app: XCUIApplication) {
        row.swipeLeft()
        let deleteAction = app.buttons["Delete"].firstMatch
        XCTAssertTrue(deleteAction.waitForExistence(timeout: 5))
        deleteAction.tap()
    }

    private func dragTranscriptTowardOlderMessages(in app: XCUIApplication) {
        let transcript = app.scrollViews["scroll.openclaw.transcript"]
        XCTAssertTrue(transcript.waitForExistence(timeout: 5))

        for _ in 0..<3 {
            transcript.swipeDown()
        }
    }
}
