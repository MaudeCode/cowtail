import Foundation
import OSLog

@MainActor
final class OpenClawStore: ObservableObject {
    @Published private(set) var displayName: String
    @Published private(set) var threads: [OpenClawThread]
    @Published private(set) var messagesByThreadID: [String: [OpenClawMessageWithActions]]
    @Published private(set) var isSignedOut: Bool
    @Published var errorMessage: String?

    var unreadCount: Int {
        threads.reduce(0) { $0 + $1.unreadCount }
    }

    private let api: any OpenClawAPIClient
    private let appSessionManager: AppSessionManager
    private let defaults: UserDefaults
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "openclawStore"
    )

    private static let displayNameKey = "openclaw.displayName"

    init(
        api: any OpenClawAPIClient = OpenClawAPI(),
        appSessionManager: AppSessionManager = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.api = api
        self.appSessionManager = appSessionManager
        self.defaults = defaults
        self.displayName = defaults.string(forKey: Self.displayNameKey) ?? ""
        self.threads = []
        self.messagesByThreadID = [:]
        self.isSignedOut = false
    }

    func refreshIfPossible() async {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            isSignedOut = true
            return
        }

        do {
            async let preferences = api.fetchPreferences(sessionToken: sessionToken)
            async let threadList = api.fetchThreads(sessionToken: sessionToken)

            let (fetchedDisplayName, fetchedThreads) = try await (preferences, threadList)
            displayName = fetchedDisplayName
            defaults.set(fetchedDisplayName, forKey: Self.displayNameKey)
            threads = sortedThreads(fetchedThreads)
            isSignedOut = false
            errorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("refresh failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    @discardableResult
    func updateDisplayName(_ displayName: String) async -> Bool {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            isSignedOut = true
            errorMessage = "Sign in from Farmhouse to update OpenClaw settings."
            return false
        }

        do {
            let updated = try await api.updatePreferences(displayName: displayName, sessionToken: sessionToken)
            self.displayName = updated
            defaults.set(updated, forKey: Self.displayNameKey)
            isSignedOut = false
            errorMessage = nil
            return true
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return false }
            logger.error("display name update failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
            return false
        }
    }

    func loadMessages(threadId: String) async {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            isSignedOut = true
            return
        }

        do {
            let messages = try await api.fetchMessages(threadId: threadId, sessionToken: sessionToken)
            messagesByThreadID[threadId] = sortedMessages(messages)
            isSignedOut = false
            errorMessage = nil
        } catch {
            guard !NetworkErrorClassifier.isCancellation(error) else { return }
            logger.error("message load failed: \(String(describing: error), privacy: .public)")
            errorMessage = error.localizedDescription
        }
    }

    private func sortedThreads(_ threads: [OpenClawThread]) -> [OpenClawThread] {
        threads.sorted {
            ($0.lastMessageAt ?? $0.updatedAt) > ($1.lastMessageAt ?? $1.updatedAt)
        }
    }

    private func sortedMessages(_ messages: [OpenClawMessageWithActions]) -> [OpenClawMessageWithActions] {
        messages.sorted { $0.createdAt < $1.createdAt }
    }
}
