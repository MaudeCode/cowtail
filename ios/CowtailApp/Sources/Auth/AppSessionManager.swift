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
    private let defaults = UserDefaults.standard
    private let tokenKey = "appSession.token"
    private let userIDKey = "appSession.userID"
    private let expiresAtKey = "appSession.expiresAt"
    private let providerKey = "appSession.provider"
    private var isUITesting = false
    private var sessionToken: String?
    private var refreshTask: Task<String?, Never>?
    private var refreshToken: UUID?

    private init() {}

    func configure() {
        isUITesting = false
        sessionToken = keychain.string(for: tokenKey)
        userID = keychain.string(for: userIDKey) ?? defaults.string(forKey: userIDKey)
        provider = defaults.string(forKey: providerKey)

        if let rawExpiresAt = defaults.object(forKey: expiresAtKey) as? Double {
            expiresAt = Date(timeIntervalSince1970: rawExpiresAt)
        }

        if !hasValidPersistedSession {
            clearSession()
            return
        }

        sessionState = .ready
        lastError = nil
    }

    var hasValidPersistedSession: Bool {
        guard
            let sessionToken,
            !sessionToken.isEmpty,
            let userID,
            !userID.isEmpty,
            let expiresAt
        else {
            return false
        }

        if expiresAt <= Date() {
            return false
        }

        if isAppleSession, let appleUserID = AppleAccountManager.shared.userID, appleUserID != userID {
            return false
        }

        return true
    }

    /// Sessions stored before providers were recorded came from Apple.
    private var isAppleSession: Bool {
        (provider ?? Self.appleProvider) == Self.appleProvider
    }

    func validSessionToken() -> String? {
        if hasValidPersistedSession {
            return sessionToken
        }

        clearSession()
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
            sessionState = .idle
            lastError = nil
            return nil
        }

        print("[roundup-debug] AppSessionManager.refreshSessionIfPossible creating backend session")
        logger.debug("refreshSessionIfPossible creating backend session")
        sessionState = .refreshing
        lastError = nil

        let refreshToken = UUID()
        let refreshTask = Task<String?, Never> { [api] in
            do {
                let session = try await api.createAuthSession(identityToken: identityToken)
                await MainActor.run {
                    print("[roundup-debug] AppSessionManager.refreshSessionIfPossible session created userID=\(session.userID)")
                    self.logger.debug("refreshSessionIfPossible session created for user \(session.userID, privacy: .public)")
                    self.store(session, provider: Self.appleProvider)
                }
                return session.token
            } catch {
                await MainActor.run {
                    print("[roundup-debug] AppSessionManager.refreshSessionIfPossible failed error=\(error.localizedDescription)")
                    self.logger.error("refreshSessionIfPossible failed: \(error.localizedDescription, privacy: .public)")
                    self.clearSession()
                    self.userID = appleUserID
                    self.sessionState = .failed
                    self.lastError = error.localizedDescription
                }
                return nil
            }
        }

        self.refreshTask = refreshTask
        self.refreshToken = refreshToken
        let token = await refreshTask.value
        if self.refreshToken == refreshToken {
            self.refreshTask = nil
            self.refreshToken = nil
        }
        return token
    }

    func clearSession() {
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
        if !isAppleSession, hasValidPersistedSession {
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
        userID = session.userID
        expiresAt = session.expiresAt
        self.provider = provider
        sessionState = .ready
        lastError = nil

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
