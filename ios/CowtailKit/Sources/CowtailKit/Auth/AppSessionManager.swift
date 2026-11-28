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
    private struct StoredSession: Codable {
        let session: AppAuthSession
        let provider: String
        let renewAfter: Date
    }

    private let storedSessionKey = "appSession.credentials"
    private var pendingSave: StoredSession?
    private var renewAfter = Date.distantPast
    private var renewalRefused = false
    private let tokenKey = "appSession.token"
    private let oidcRefreshKey = "appSession.oidcRefreshToken"
    private let userIDKey = "appSession.userID"
    private let expiresAtKey = "appSession.expiresAt"
    private let providerKey = "appSession.provider"
    private(set) var needsKeychainRestore = false
    private var isUITesting = false
    private var sessionToken: String?
    private var oidcRefreshToken: String?
    private var refreshTask: Task<String?, Never>?
    private var refreshToken: UUID?

    private init() {}

    func configure() {
        isUITesting = false
        if pendingSave != nil {
            persistPendingSession()
            return
        }
        do {
            if let value = try keychain.readString(for: storedSessionKey) {
                let record = try JSONDecoder().decode(StoredSession.self, from: Data(value.utf8))
                apply(record)
                needsKeychainRestore = false
                sessionState = hasValidPersistedSession ? .ready : .idle
                return
            }
            // Sessions saved by earlier releases upgrade on their next successful renewal.
            renewAfter = .distantPast
            let token = try keychain.readString(for: tokenKey)
            let refresh = try keychain.readString(for: oidcRefreshKey)
            let savedUserID = try keychain.readString(for: userIDKey)
            sessionToken = token
            oidcRefreshToken = refresh
            userID = savedUserID ?? defaults.string(forKey: userIDKey)
            provider = defaults.string(forKey: providerKey)
            expiresAt = (defaults.object(forKey: expiresAtKey) as? Double).map(Date.init(timeIntervalSince1970:))
            needsKeychainRestore = (token == nil && userID != nil) || (token != nil && userID == nil)
        } catch {
            needsKeychainRestore = true
            return
        }

        sessionState = hasValidPersistedSession ? .ready : .idle
        lastError = nil
    }

    var hasValidPersistedSession: Bool {
        guard
            !renewalRefused,
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
        signedInUserID != nil
    }

    var signedInUserID: String? {
        guard !renewalRefused else { return nil }
        if hasValidPersistedSession || hasRenewableOIDCSession {
            return userID
        }
        return isAppleSession ? AppleAccountManager.shared.userID : nil
    }

    private var hasRenewableOIDCSession: Bool {
        !isAppleSession && sessionToken?.isEmpty == false && userID?.isEmpty == false &&
            oidcRefreshToken?.isEmpty == false
    }

    /// Sessions stored before providers were recorded came from Apple.
    var isAppleSession: Bool {
        (provider ?? Self.appleProvider) == Self.appleProvider
    }

    func validSessionToken() -> String? {
        if hasValidPersistedSession {
            return sessionToken
        }

        return nil
    }

    func refreshSessionIfPossible() async -> String? {
        if isUITesting {
            return sessionToken
        }

        if needsKeychainRestore {
            configure()
        }
        guard !needsKeychainRestore || pendingSave != nil else { return nil }

        if let refreshTask {
            return await refreshTask.value
        }
        if hasRenewableOIDCSession, let provider, let sessionToken, let oidcRefreshToken {
            guard !renewalRefused else { return nil }
            if Date() < renewAfter, let valid = validSessionToken() {
                return valid
            }

            return await renewSession(provider: provider, fallback: validSessionToken()) { [api] in
                try await api.refreshOIDCSession(sessionToken: sessionToken, refreshToken: oidcRefreshToken)
            }
        }
        if let token = validSessionToken() {
            return token
        }

        guard isAppleSession else { return nil }

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
        fallback: String? = nil,
        request: @escaping @Sendable () async throws -> AppAuthSession?
    ) async -> String? {
        sessionState = .refreshing
        lastError = nil
        let refreshToken = UUID()
        self.refreshToken = refreshToken
        let task = Task<String?, Never> { [api] in
            defer {
                if self.refreshToken == refreshToken {
                    self.refreshTask = nil
                    self.refreshToken = nil
                }
            }
            do {
                let session = try await request()
                guard self.refreshToken == refreshToken, !Task.isCancelled else {
                    // A sign-out or a new sign-in won while the server was issuing a bearer.
                    if let session {
                        try await api.logout(sessionToken: session.token)
                    }
                    return nil
                }
                guard let session else {
                    // Only a sign-out drops a session: keep it, and say renewal failed.
                    self.sessionState = .failed
                    self.renewalRefused = true
                    self.lastError = "Sign in with \(provider) again to renew your session."
                    return nil
                }
                self.install(session, provider: provider)
                return session.token
            } catch {
                guard self.refreshToken == refreshToken, !Task.isCancelled else { return nil }
                self.logger.error("Session renewal failed: \(error.localizedDescription, privacy: .public)")
                self.sessionState = .failed
                self.lastError = error.localizedDescription
                if let fallback, NetworkErrorClassifier.isTransientConnectionFailure(error) || (error as? CowtailAPIError)?.isTemporaryFailure == true {
                    // The server still authorizes every use of this bearer. Back off after a
                    // temporary failure without replaying the caller's operation.
                    self.renewAfter = Date().addingTimeInterval(60)
                    return fallback
                }
                return nil
            }
        }
        refreshTask = task
        return await task.value
    }

    func clearSession() {
        needsKeychainRestore = false
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
        refreshTask = nil
        refreshToken = nil
        clearSession()
    }

    /// Ends the session for either provider: clears it at once, then revokes it on the server.
    @discardableResult
    func signOut() -> Task<Void, Never>? {
        let token = sessionToken
        let renewal = refreshTask
        invalidateSession()
        guard let token, !token.isEmpty else { return nil }
        return Task { [api, logger] in
            do {
                try await api.logout(sessionToken: token)
            } catch {
                logger.error("signOut logout failed: \(error.localizedDescription, privacy: .public)")
            }
            _ = await renewal?.value
        }
    }

    func appleIdentityDidChange() {
        if needsKeychainRestore {
            configure()
        }
        // A completed interactive Apple sign-in may replace an incomplete saved account.
        // A background callback cannot assume an unreadable session belongs to Apple.
        if needsKeychainRestore || !isAppleSession {
            guard !hasValidPersistedSession, !hasRenewableOIDCSession || renewalRefused,
                  AppleAccountManager.shared.identityToken != nil else { return }
            invalidateSession()
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
        // An interactive sign-in supersedes any older request still returning.
        refreshTask = nil
        refreshToken = nil
        install(session, provider: provider)
    }

    private func install(_ session: AppAuthSession, provider: String) {
        let day: TimeInterval = 86400
        let record = StoredSession(session: session, provider: provider,
                                   renewAfter: min(Date().addingTimeInterval(day), session.expiresAt.addingTimeInterval(-day)))
        apply(record)
        needsKeychainRestore = false
        renewalRefused = false
        sessionState = .ready
        lastError = nil
        pendingSave = record
        persistPendingSession()
    }

    private func apply(_ record: StoredSession) {
        sessionToken = record.session.token
        oidcRefreshToken = record.session.refreshToken
        userID = record.session.userID
        expiresAt = record.session.expiresAt
        provider = record.provider
        renewAfter = record.renewAfter
    }

    private func persistPendingSession() {
        guard let pendingSave else { return }
        do {
            let data = try JSONEncoder().encode(pendingSave)
            try keychain.write(String(decoding: data, as: UTF8.self), for: storedSessionKey)
            self.pendingSave = nil
            needsKeychainRestore = false
            lastError = nil
            removeLegacySession()
        } catch {
            needsKeychainRestore = true
            lastError = "Cowtail could not save the renewed session. Unlock the device to retry."
        }
    }

    func resetForUITesting() {
        needsKeychainRestore = false
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
        pendingSave = nil
        renewalRefused = false
        renewAfter = .distantPast
        keychain.remove(storedSessionKey)
        removeLegacySession()
    }

    private func removeLegacySession() {
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
