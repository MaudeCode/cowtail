import SwiftUI
import UIKit
import XCTest
@testable import Cowtail

@MainActor
final class HostedSettingsTests: XCTestCase {
    func testInboxToolbarOpensSettingsWithSectionsInOrder() throws {
        let screen = try HostedScreen.root(.notificationsReady)
        defer { screen.close() }
        try screen.activate("button.inbox.settings")
        let sections = ["Account", "Notifications", "Urgency overrides", "Appearance", "Devices", "Developer", "Links"]
            .map { "section.\($0)" }
        screen.assertVisible(Array(sections.prefix(3)) + ["button.settings.add-override"])
        XCTAssertEqual(screen.element("button.settings.add-override")?.accessibilityLabel, "Add override")

        let form = try XCTUnwrap(screen.firstView(ofType: UICollectionView.self))
        var observed: [String] = []
        let top = -form.adjustedContentInset.top
        let bottom = max(top, form.contentSize.height - form.bounds.height + form.adjustedContentInset.bottom)
        let step = form.bounds.height / 2
        XCTAssertGreaterThan(step, 0)
        guard step > 0 else { return }
        for offset in Array(stride(from: top, to: bottom, by: step)) + [bottom] {
            form.setContentOffset(CGPoint(x: form.contentOffset.x, y: offset), animated: false)
            form.layoutIfNeeded()
            let visible = sections.compactMap { identifier -> (String, CGFloat)? in
                guard let element = screen.element(identifier) else { return nil }
                return (identifier, element.accessibilityFrame.minY)
            }
            for (identifier, _) in visible.sorted(by: { $0.1 < $1.1 }) where !observed.contains(identifier) {
                observed.append(identifier)
            }
        }
        XCTAssertEqual(observed, sections)
    }

    func testDailyRoundupToggleChangesValue() throws {
        let screen = try HostedScreen.root(.notificationsReady, settings: true)
        defer { screen.close() }
        let id = "toggle.notifications.daily-roundup"
        screen.assertVisible([id])
        XCTAssertEqual(screen.element(id)?.accessibilityValue, "1")
        try screen.activate(id)
        screen.assertValue("0", for: id)
    }

    func testDeniedNotificationsOfferSystemSettings() throws {
        let screen = try HostedScreen.root(.notificationsPermissionDenied, settings: true)
        defer { screen.close() }
        screen.assertVisible(["text.notifications.summary-message", "button.notifications.open-settings"])
        XCTAssertNil(screen.element("button.notifications.primary-action"))
    }

    func testOIDCSessionNamesProviderAndOffersSignOut() throws {
        let screen = try HostedScreen.root(.signedInWithOIDC, settings: true)
        defer { screen.close() }
        screen.assertVisible(["text.settings.signed-in", "button.settings.sign-out"])
        XCTAssertEqual(screen.element("text.settings.signed-in")?.accessibilityLabel, "Signed in with Pocket ID")
        XCTAssertEqual(screen.element("button.settings.sign-out")?.accessibilityLabel, "Sign out")
        XCTAssertNil(screen.element("button.sign-in.apple"))
    }

    func testNotificationSyncErrorOffersRetry() throws {
        let screen = try HostedScreen.root(.notificationsSyncError, settings: true)
        defer { screen.close() }
        screen.assertVisible(["button.notifications.primary-action"])
        XCTAssertNil(screen.element("button.notifications.open-settings"))
    }
}
