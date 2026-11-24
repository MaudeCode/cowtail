import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Opens a sign-in page and returns the URL the page redirects to on `callbackScheme`.
@MainActor
protocol WebAuthenticationPresenting {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

/// Signs in with the server's OIDC provider (Pocket ID) through the system browser sheet,
/// and keeps the resulting session exactly as an Apple sign-in does.
@MainActor
final class OIDCSignIn: ObservableObject {
    /// The provider's name; nil when the server offers only Sign in with Apple.
    @Published private(set) var providerName: String?
    @Published private(set) var isSigningIn = false
    @Published private(set) var lastError: String?

    static let callbackScheme = "cowtail"

    private let api: any AuthAPIClient
    private let sessions: AppSessionManager
    private let presenter: any WebAuthenticationPresenting
    private let startURL: URL

    init(
        api: any AuthAPIClient,
        sessions: AppSessionManager = .shared,
        presenter: any WebAuthenticationPresenting = SystemWebAuthenticationPresenter(),
        startURL: URL = AppConfig.oidcStartURL
    ) {
        self.api = api
        self.sessions = sessions
        self.presenter = presenter
        self.startURL = startURL
    }

    func loadProviders() async {
        do {
            providerName = try await api.fetchOIDCProviderName()
        } catch {
            providerName = nil
        }
    }

    func signIn() async {
        guard !isSigningIn, let providerName else { return }
        isSigningIn = true
        lastError = nil
        defer { isSigningIn = false }

        let verifier = Self.makeVerifier()
        do {
            let callback = try await presenter.authenticate(
                url: authorizationURL(challenge: Self.challenge(for: verifier)),
                callbackScheme: Self.callbackScheme
            )
            let code = try Self.code(from: callback)
            let session = try await api.redeemOIDCHandoff(code: code, verifier: verifier)
            sessions.store(session, provider: providerName)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The owner closed the sheet; they stay signed out with nothing to report.
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func authorizationURL(challenge: String) -> URL {
        var components = URLComponents(url: startURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "client", value: "ios"),
            URLQueryItem(name: "handoff_challenge", value: challenge),
        ]
        return components?.url ?? startURL
    }

    /// RFC 7636: 32 random bytes, base64url without padding.
    private static func makeVerifier() -> String {
        var generator = SystemRandomNumberGenerator()
        return base64URL(Data((0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
    }

    private static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func code(from callback: URL) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }
        if let error = value("error") {
            throw CowtailAPIError.refused(value("error_description") ?? error)
        }
        guard let code = value("code") else {
            throw CowtailAPIError.requestFailed("Sign-in returned without a code.")
        }
        return code
    }
}

/// The production presenter: an `ASWebAuthenticationSession` that shares Safari's cookies,
/// so an existing Pocket ID passkey session signs in without a prompt.
@MainActor
final class SystemWebAuthenticationPresenter: NSObject, WebAuthenticationPresenting,
    ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        guard session == nil else {
            throw CowtailAPIError.requestFailed("A sign-in is already open.")
        }
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme(callbackScheme)
            ) { @Sendable [weak self] callback, error in
                Task { @MainActor in
                    self?.session = nil
                    if let callback {
                        continuation.resume(returning: callback)
                    } else {
                        continuation.resume(throwing: error ?? ASWebAuthenticationSessionError(.canceledLogin))
                    }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            guard session.start() else {
                self.session = nil
                continuation.resume(throwing: CowtailAPIError.requestFailed("The sign-in sheet could not open."))
                return
            }
        }
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
    }
}
