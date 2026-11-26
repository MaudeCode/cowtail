import Foundation
import OSLog

@MainActor
final class AppSessionManager: ObservableObject {
    static let shared = AppSessionManager()
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "appSession"
    )

    enum SessionState: Equatable {
        case idle
        case refreshing
        case ready
        case failed
    }

    @Published private(set) var sessionState: SessionState = .idle
    @Published private(set) var userID: String?
    @Published private(set) var expiresAt: Date?
    @Published private(set) var lastError: String?
    /// The sign-in method that produced the session, as the account row names it.
    @Published private(set) var provider: String?

    nonisolated static let appleProvider = "Apple"

    /// AppRuntime points this at the seeded server for UI tests.
    var api: any AuthAPIClient = CowtailAPI()
    private let keychain = KeychainStore(service: Bundle.main.bundleIdentifier ?? "Cowtail")
    private let defaults = UserDefaults.cowtail
    private let tokenKey = "appSession.token"
    private let oidcRefreshKey = "appSession.oidcRefreshToken"
    private let userIDKey = "appSession.userID"
    private let expiresAtKey = "appSession.expiresAt"
    private let providerKey = "appSession.provider"
    private var isUITesting = false
    private var sessionToken: String?
    private var oidcRefreshToken: String?
    private var refreshTask: Task<String?, Never>?
    private var refreshToken: UUID?

    private init() {}

    func configure() {
        isUITesting = false
        sessionToken = keychain.string(for: tokenKey)
        oidcRefreshToken = keychain.string(for: oidcRefreshKey)
        userID = keychain.string(for: userIDKey) ?? defaults.string(forKey: userIDKey)
        provider = defaults.string(forKey: providerKey)

        if let rawExpiresAt = defaults.object(forKey: expiresAtKey) as? Double {
            expiresAt = Date(timeIntervalSince1970: rawExpiresAt)
        }

        if !hasValidPersistedSession && !hasRenewableOIDCSession {
            clearSession()
            return
        }

        sessionState = hasValidPersistedSession ? .ready : .idle
        lastError = nil
    }

    var hasValidPersistedSession: Bool {
        guard
            let sessionToken,
            !sessionToken.isEmpty,
            let userID,
            !userID.isEmpty
        else {
            return false
        }

        // The server slides expiry on use, so a past stored expiry never drops a session. It only
        // sends a Pocket ID session through renewal, which also revives one the server let lapse.
        if let expiresAt, expiresAt <= Date(), hasRenewableOIDCSession {
            return false
        }

        if isAppleSession, let appleUserID = AppleAccountManager.shared.userID, appleUserID != userID {
            return false
        }

        return true
    }

    /// Signed in while an Apple identity or a session from any provider exists; the app's root
    /// shows the tabs only then.
    var isSignedIn: Bool {
        AppleAccountManager.shared.userID != nil || hasValidPersistedSession || hasRenewableOIDCSession
    }

    private var hasRenewableOIDCSession: Bool {
        !isAppleSession && sessionToken?.isEmpty == false && userID?.isEmpty == false &&
            oidcRefreshToken?.isEmpty == false
    }

    /// Sessions stored before providers were recorded came from Apple.
    private var isAppleSession: Bool {
        (provider ?? Self.appleProvider) == Self.appleProvider
    }

    func validSessionToken() -> String? {
        if hasValidPersistedSession {
            return sessionToken
        }

        if !hasRenewableOIDCSession {
            clearSession()
        }
        return nil
    }

    func refreshSessionIfPossible() async -> String? {
        if isUITesting {
            return sessionToken
        }

        if let token = validSessionToken() {
            print("[roundup-debug] AppSessionManager.refreshSessionIfPossible using cached session")
            logger.debug("refreshSessionIfPossible using cached session")
            return token
        }

        if let refreshTask {
            print("[roundup-debug] AppSessionManager.refreshSessionIfPossible awaiting in-flight refresh")
            logger.debug("refreshSessionIfPossible awaiting in-flight refresh")
            return await refreshTask.value
        }

        if hasRenewableOIDCSession, let provider, let sessionToken, let oidcRefreshToken {
            return await renewSession(provider: provider) { [api] in
                try await api.refreshOIDCSession(sessionToken: sessionToken, refreshToken: oidcRefreshToken)
            }
        }

        guard let appleUserID = AppleAccountManager.shared.userID, !appleUserID.isEmpty else {
            print("[roundup-debug] AppSessionManager.refreshSessionIfPossible no Apple user ID")
            logger.debug("refreshSessionIfPossible no Apple user ID")
            sessionState = .idle
            lastError = nil
            return nil
        }

        guard let identityToken = AppleAccountManager.shared.identityToken, !identityToken.isEmpty else {
            print("[roundup-debug] AppSessionManager.refreshSessionIfPossible missing Apple identity token")
            logger.debug("refreshSessionIfPossible missing Apple identity token")
            sessionState = .failed
            lastError = "The Apple identity token is unavailable."
            return nil
        }

        return await renewSession(provider: Self.appleProvider) { [api] in
            try await api.createAuthSession(identityToken: identityToken)
        }
    }

    private func renewSession(
        provider: String,
        request: @escaping @Sendable () async throws -> AppAuthSession?
    ) async -> String? {
        sessionState = .refreshing
        lastError = nil
        let refreshToken = UUID()
        self.refreshToken = refreshToken
        let task = Task<String?, Never> {
            defer {
                if self.refreshToken == refreshToken {
                    self.refreshTask = nil
                    self.refreshToken = nil
                }
            }
            do {
                let session = try await request()
                guard self.refreshToken == refreshToken, !Task.isCancelled else { return nil }
                guard let session else {
                    // Only a sign-out drops a session: keep it, and say renewal failed.
                    self.sessionState = .failed
                    self.lastError = "Cowtail did not renew the session."
                    return nil
                }
                self.store(session, provider: provider)
                return session.token
            } catch {
                guard self.refreshToken == refreshToken, !Task.isCancelled else { return nil }
                self.logger.error("Session renewal failed: \(error.localizedDescription, privacy: .public)")
                self.sessionState = .failed
                self.lastError = error.localizedDescription
                return nil
            }
        }
        refreshTask = task
        return await task.value
    }

    func clearSession() {
        oidcRefreshToken = nil
        clearStoredSession()
        applyUITestState(
            sessionState: .idle,
            token: nil,
            userID: nil,
            expiresAt: nil,
            lastError: nil,
            provider: nil
        )
    }

    func invalidateSession() {
        print("[roundup-debug] AppSessionManager.invalidateSession")
        logger.debug("invalidateSession")
        refreshTask?.cancel()
        refreshTask = nil
        refreshToken = nil
        clearSession()
    }

    /// Ends the session for either provider: clears it at once, then revokes it on the server.
    @discardableResult
    func signOut() -> Task<Void, Never>? {
        let token = sessionToken
        invalidateSession()
        guard let token, !token.isEmpty else { return nil }
        return Task { [api, logger] in
            do {
                try await api.logout(sessionToken: token)
            } catch {
                logger.error("signOut logout failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    func appleIdentityDidChange() {
        // An Apple identity change leaves a session from another provider alone.
        if !isAppleSession, hasValidPersistedSession || hasRenewableOIDCSession {
            return
        }

        if AppleAccountManager.shared.userID == nil {
            invalidateSession()
            return
        }

        if let currentUserID = userID,
           let appleUserID = AppleAccountManager.shared.userID,
           currentUserID != appleUserID {
            invalidateSession()
        }

        Task {
            _ = await refreshSessionIfPossible()
        }
    }

    /// The one place a new session is kept, whichever provider signed in.
    func store(_ session: AppAuthSession, provider: String) {
        sessionToken = session.token
        oidcRefreshToken = session.refreshToken
        userID = session.userID
        expiresAt = session.expiresAt
        self.provider = provider
        sessionState = .ready
        lastError = nil

        if let refreshToken = session.refreshToken {
            keychain.set(refreshToken, for: oidcRefreshKey)
        } else {
            keychain.remove(oidcRefreshKey)
        }
        keychain.set(session.token, for: tokenKey)
        keychain.set(session.userID, for: userIDKey)
        defaults.set(session.userID, forKey: userIDKey)
        defaults.set(session.expiresAt.timeIntervalSince1970, forKey: expiresAtKey)
        defaults.set(provider, forKey: providerKey)
    }

    func resetForUITesting() {
        isUITesting = true
        refreshTask?.cancel()
        refreshTask = nil
        refreshToken = nil
        clearStoredSession()
        applyUITestState(
            sessionState: .idle,
            token: nil,
            userID: nil,
            expiresAt: nil,
            lastError: nil,
            provider: nil
        )
    }

    func seedForUITesting(
        sessionState: SessionState,
        token: String?,
        userID: String?,
        expiresAt: Date?,
        lastError: String?,
        provider: String? = nil
    ) {
        isUITesting = true
        refreshTask?.cancel()
        refreshTask = nil
        refreshToken = nil
        applyUITestState(
            sessionState: sessionState,
            token: token,
            userID: userID,
            expiresAt: expiresAt,
            lastError: lastError,
            provider: provider
        )
    }

    private func clearStoredSession() {
        keychain.remove(tokenKey)
        keychain.remove(oidcRefreshKey)
        keychain.remove(userIDKey)
        defaults.removeObject(forKey: userIDKey)
        defaults.removeObject(forKey: expiresAtKey)
        defaults.removeObject(forKey: providerKey)
    }

    private func applyUITestState(
        sessionState: SessionState,
        token: String?,
        userID: String?,
        expiresAt: Date?,
        lastError: String?,
        provider: String?
    ) {
        self.provider = provider
        self.sessionToken = token
        self.userID = userID
        self.expiresAt = expiresAt
        self.sessionState = sessionState
        self.lastError = lastError
    }
}
