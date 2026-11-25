import XCTest

/// Apple's accessibility audit on Inbox, an item page and Settings: every control's hit region
/// is at least 44 × 44 pt, and all text follows Dynamic Type.
@MainActor
final class AccessibilityAuditTests: XCTestCase {
    func testInboxPassesTheHitRegionAndDynamicTypeAudit() throws {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()
        XCTAssertTrue(app.element("row.item.alert-crashloop").waitForExistence(timeout: 10))

        try app.auditHitRegionsAndDynamicType()
    }

    func testItemPagePassesTheHitRegionAndDynamicTypeAudit() throws {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()
        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.element("text.item.title").waitForExistence(timeout: 10))

        try app.auditHitRegionsAndDynamicType()
    }

    /// The audit lets a 30 pt control through, so the item's icon actions hold Apple's 44 pt minimum here.
    func testItemIconActionsAreAtLeast44PointsSquare() {
        let app = AppLaunching.configuredApp(scenario: "inbox_populated")
        app.launch()
        let row = app.element("row.item.alert-crashloop")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()

        for action in ["ack", "snooze", "retry", "mark-noise", "escalate"] {
            let button = app.buttons["button.item.\(action).alert-crashloop"]
            XCTAssertTrue(button.waitForExistence(timeout: 10), action)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, action)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, action)
        }
    }

    func testSettingsPassesTheHitRegionAndDynamicTypeAudit() throws {
        let app = AppLaunching.configuredApp(scenario: "notifications_ready", startTab: "settings")
        app.launch()
        XCTAssertTrue(app.element("section.Account").waitForExistence(timeout: 10))

        try app.auditHitRegionsAndDynamicType()
    }
}

extension XCUIApplication {
    /// Fails once per issue, naming the element, which the audit's own failure leaves out.
    func auditHitRegionsAndDynamicType(file: StaticString = #filePath, line: UInt = #line) throws {
        try performAccessibilityAudit(for: [.hitRegion, .dynamicType]) { issue in
            let element = issue.element
            XCTFail(
                "\(issue.compactDescription): \(element?.elementType.rawValue ?? 0) "
                    + "id=\(element?.identifier ?? "") label=\(element?.label ?? "") frame=\(element?.frame ?? .zero)",
                file: file,
                line: line
            )
            return true
        }
    }
}
