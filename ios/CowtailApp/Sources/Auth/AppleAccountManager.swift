import AuthenticationServices
import Foundation

@MainActor
final class AppleAccountManager: NSObject, ObservableObject {
    static let shared = AppleAccountManager()

    enum SignInState {
        case signedOut
        case restoring
        case signedIn
        case failed

        var label: String {
            switch self {
            case .signedOut:
                return "Signed out"
            case .restoring:
                return "Checking Apple ID"
            case .signedIn:
                return "Signed in"
            case .failed:
                return "Sign in failed"
            }
        }
    }

    @Published private(set) var signInState: SignInState = .signedOut
    @Published private(set) var userID: String?
    @Published private(set) var identityToken: String?
    @Published private(set) var displayName: String?
    @Published private(set) var email: String?
    @Published private(set) var lastError: String?

    private let provider = ASAuthorizationAppleIDProvider()
    private let keychain = KeychainStore(service: Bundle.main.bundleIdentifier ?? "Cowtail")
    private let userDefaults = UserDefaults.standard
    private let userIDKey = "appleAccount.userID"
    private let displayNameKey = "appleAccount.displayName"
    private let emailKey = "appleAccount.email"

    private override init() {
        super.init()
    }

    func configure() {
        userID = keychain.string(for: userIDKey)
        displayName = keychain.string(for: displayNameKey) ?? userDefaults.string(forKey: displayNameKey)
        email = keychain.string(for: emailKey) ?? userDefaults.string(forKey: emailKey)

        if userID != nil {
            signInState = .restoring
            Task {
                await refreshCredentialState()
            }
        }
    }

    func configure(_ request: ASAuthorizationAppleIDRequest) {
        request.requestedScopes = [.fullName, .email]
    }

    func handleCompletion(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                signInState = .failed
                lastError = "Apple returned an unexpected credential."
                return
            }

            let resolvedDisplayName = PersonNameComponentsFormatter().string(from: credential.fullName ?? PersonNameComponents())
            let trimmedDisplayName = resolvedDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
            let identityToken = credential.identityToken.flatMap { String(data: $0, encoding: .utf8) }

            storeIdentity(
                userID: credential.user,
                identityToken: identityToken,
                displayName: trimmedDisplayName.isEmpty ? displayName : trimmedDisplayName,
                email: credential.email ?? email
            )
        case .failure(let error):
            signInState = .failed
            lastError = error.localizedDescription
        }
    }

    func refreshCredentialState() async {
        guard let userID else {
            signInState = .signedOut
            return
        }

        do {
            let state = try await credentialState(for: userID)
            switch state {
            case .authorized:
                signInState = .signedIn
                lastError = nil
            case .revoked, .notFound:
                clearIdentity()
            case .transferred:
                signInState = .failed
                lastError = "Apple ID credential was transferred and needs a fresh sign in."
            @unknown default:
                signInState = .failed
                lastError = "Apple ID credential state is unknown."
            }
        } catch {
            signInState = .failed
            lastError = error.localizedDescription
        }
    }

    func clearIdentity() {
        keychain.remove(userIDKey)
        keychain.remove(displayNameKey)
        keychain.remove(emailKey)

        userDefaults.removeObject(forKey: displayNameKey)
        userDefaults.removeObject(forKey: emailKey)

        userID = nil
        identityToken = nil
        displayName = nil
        email = nil
        signInState = .signedOut
        lastError = nil

        NotificationManager.shared.appleIdentityDidChange()
    }

    func needsFreshIdentityToken() -> Bool {
        identityToken == nil
    }

    private func storeIdentity(userID: String, identityToken: String?, displayName: String?, email: String?) {
        keychain.set(userID, for: userIDKey)

        if let displayName, !displayName.isEmpty {
            keychain.set(displayName, for: displayNameKey)
            userDefaults.set(displayName, forKey: displayNameKey)
        }

        if let email, !email.isEmpty {
            keychain.set(email, for: emailKey)
            userDefaults.set(email, forKey: emailKey)
        }

        self.userID = userID
        self.identityToken = identityToken
        self.displayName = displayName ?? self.displayName
        self.email = email ?? self.email
        self.signInState = .signedIn
        self.lastError = nil

        NotificationManager.shared.appleIdentityDidChange()
    }

    private func credentialState(for userID: String) async throws -> ASAuthorizationAppleIDProvider.CredentialState {
        try await withCheckedThrowingContinuation { continuation in
            provider.getCredentialState(forUserID: userID) { state, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: state)
            }
        }
    }
}
