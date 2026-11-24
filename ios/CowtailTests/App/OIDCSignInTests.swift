import AuthenticationServices
import CryptoKit
import Foundation
import HTTPTypes
import XCTest
@testable import Cowtail

@MainActor
final class OIDCSignInTests: XCTestCase {
    private static let startURL = URL(string: "https://cowtail.test/api/auth/oidc/start")!
    private static let pocketID = RecordingTransport.Route(json: #"{"apple":true,"oidc":{"name":"Pocket ID"}}"#)
    private static let handoff = RecordingTransport.Route(
        json: #"{"ok":true,"session":{"token":"oidc-session","userId":"owner","expiresAt":4102444800000}}"#
    )

    private let sessions = AppSessionManager.shared

    override func setUp() async throws {
        sessions.resetForUITesting()
    }

    override func tearDown() async throws {
        sessions.resetForUITesting()
        sessions.api = CowtailAPI()
    }

    private struct Run {
        let oidc: OIDCSignIn
        let presenter: FakePresenter
        let transport: RecordingTransport
    }

    private func signIn(
        callback: Result<String, Error>,
        providers: RecordingTransport.Route = pocketID
    ) async -> Run {
        let transport = RecordingTransport(routes: [
            "GET /api/auth/providers": providers,
            "POST /api/auth/oidc/handoff": Self.handoff,
        ])
        let presenter = FakePresenter(callback: callback.map { URL(string: $0)! })
        let oidc = OIDCSignIn(
            api: CowtailAPI(transport: transport),
            sessions: sessions,
            presenter: presenter,
            startURL: Self.startURL
        )
        await oidc.loadProviders()
        await oidc.signIn()
        return Run(oidc: oidc, presenter: presenter, transport: transport)
    }

    func testTheStartURLCarriesTheS256ChallengeOfTheVerifierTheHandOffSends() async throws {
        let run = await signIn(callback: .success("cowtail://auth/callback?code=handoff-code"))
        let presenter = run.presenter, transport = run.transport

        let opened = try XCTUnwrap(presenter.openedURLs.first)
        XCTAssertEqual(presenter.callbackSchemes, ["cowtail"])
        let query = try XCTUnwrap(URLComponents(url: opened, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(query.first { $0.name == "client" }?.value, "ios")

        let posted = try XCTUnwrap(transport.requests("POST /api/auth/oidc/handoff").first)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: posted.body) as? [String: String])
        XCTAssertEqual(body["code"], "handoff-code")
        let verifier = try XCTUnwrap(body["verifier"])
        XCTAssertEqual(verifier.count, 43, "32 random bytes, base64url")
        let s256 = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(query.first { $0.name == "handoff_challenge" }?.value, s256)
    }

    func testASuccessfulSignInStoresTheSessionUnderTheProvidersName() async {
        let oidc = await signIn(callback: .success("cowtail://auth/callback?code=handoff-code")).oidc

        XCTAssertNil(oidc.lastError)
        XCTAssertEqual(sessions.sessionState, .ready)
        XCTAssertEqual(sessions.validSessionToken(), "oidc-session")
        XCTAssertEqual(sessions.userID, "owner")
        XCTAssertEqual(sessions.provider, "Pocket ID")
    }

    func testCancellingTheSheetLeavesTheAppSignedOutWithNoError() async {
        let run = await signIn(callback: .failure(ASWebAuthenticationSessionError(.canceledLogin)))
        let oidc = run.oidc, transport = run.transport

        XCTAssertNil(oidc.lastError)
        XCTAssertNil(sessions.validSessionToken())
        XCTAssertTrue(transport.requests("POST /api/auth/oidc/handoff").isEmpty)
    }

    func testAnErrorCallbackShowsItsMessage() async {
        let run = await signIn(
            callback: .success("cowtail://auth/callback?error=access_denied&error_description=The%20owner%20declined")
        )
        let oidc = run.oidc, transport = run.transport

        XCTAssertEqual(oidc.lastError, "The owner declined")
        XCTAssertNil(sessions.validSessionToken())
        XCTAssertTrue(transport.requests("POST /api/auth/oidc/handoff").isEmpty)
    }

    func testWithoutAnOIDCProviderThereIsNoSignIn() async {
        let run = await signIn(
            callback: .success("cowtail://auth/callback?code=handoff-code"),
            providers: .init(json: #"{"apple":true}"#)
        )
        let oidc = run.oidc, presenter = run.presenter

        XCTAssertNil(oidc.providerName)
        XCTAssertTrue(presenter.openedURLs.isEmpty)
    }

    func testSignOutRevokesTheSessionAndClearsItForEitherProvider() async {
        for provider in [AppSessionManager.appleProvider, "Pocket ID"] {
            let transport = RecordingTransport(routes: ["POST /api/auth/logout": .init(json: #"{"ok":true}"#)])
            sessions.api = CowtailAPI(transport: transport)
            sessions.store(
                AppAuthSession(token: "token-\(provider)", userID: "owner", expiresAt: .distantFuture),
                provider: provider
            )

            let logout = sessions.signOut()

            XCTAssertNil(sessions.validSessionToken(), provider)
            XCTAssertNil(sessions.provider, provider)
            await logout?.value
            let revoked = transport.requests("POST /api/auth/logout")
            XCTAssertEqual(revoked.count, 1, provider)
            XCTAssertEqual(revoked.first?.request.headerFields[.authorization], "Bearer token-\(provider)", provider)
        }
    }
}

/// Stands in for the browser sheet: records what it opened and answers with a fixed callback.
@MainActor
private final class FakePresenter: WebAuthenticationPresenting {
    private let callback: Result<URL, Error>
    private(set) var openedURLs: [URL] = []
    private(set) var callbackSchemes: [String] = []

    init(callback: Result<URL, Error>) {
        self.callback = callback
    }

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        openedURLs.append(url)
        callbackSchemes.append(callbackScheme)
        return try callback.get()
    }
}
