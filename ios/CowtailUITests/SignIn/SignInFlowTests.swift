import XCTest

/// The app's root while no session or Apple identity exists, the notification step after a sign-in,
/// and the return to it on sign-out.
@MainActor
final class SignInFlowTests: XCTestCase {
    func testSignedOutLaunchOffersAppleThenTheServersOIDCProviderInPlaceOfTheTabs() {
        let app = AppLaunching.configuredApp(scenario: "signed_out_with_oidc")
        app.launch()

        let oidc = app.buttons["button.sign-in.oidc"]
        XCTAssertTrue(oidc.waitForExistence(timeout: 10))
        XCTAssertEqual(oidc.label, "Sign in with Pocket ID")
        let apple = app.buttons.matching(identifier: "button.sign-in.apple")
        XCTAssertEqual(apple.count, 1)
        XCTAssertLessThan(apple.firstMatch.frame.minY, oidc.frame.minY, "Sign in with Apple comes first")
        XCTAssertFalse(app.tabBars.firstMatch.exists)
    }

    func testSignInOffersOnlyAppleWhenTheServerListsNoOIDCProvider() {
        let app = AppLaunching.configuredApp(scenario: "signed_out")
        app.launch()

        XCTAssertTrue(app.buttons["button.sign-in.apple"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["button.sign-in.oidc"].exists)
    }

    func testSigningInAsksForNotificationsAndNotNowOpensTheTabs() {
        let app = AppLaunching.configuredApp(scenario: "signed_out_with_oidc")
        app.launch()

        let oidc = app.buttons["button.sign-in.oidc"]
        XCTAssertTrue(oidc.waitForExistence(timeout: 10))
        oidc.tap()

        let notNow = app.buttons["button.notification-step.not-now"]
        XCTAssertTrue(notNow.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["button.notification-step.turn-on"].exists)
        notNow.tap()

        XCTAssertTrue(app.buttons["button.inbox.settings"].waitForExistence(timeout: 10))
    }

    func testSigningOutFromSettingsReturnsToSignIn() {
        let app = AppLaunching.configuredApp(scenario: "signed_in_with_oidc", startTab: "settings")
        app.launch()

        let signOut = app.buttons["button.settings.sign-out"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 10))
        signOut.tap()

        XCTAssertTrue(app.buttons["button.sign-in.oidc"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.tabBars.firstMatch.exists)
    }
}
