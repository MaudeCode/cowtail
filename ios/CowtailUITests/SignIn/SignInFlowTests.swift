import XCTest

/// The launched app routes a signed-out session to the appropriate sign-in options.
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
}
