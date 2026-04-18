import Foundation
import OSLog
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class NotificationManager: NSObject, ObservableObject {
    static let shared = NotificationManager()
    private let api = CowtailAPI()
    private let appSessionManager = AppSessionManager.shared
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "notifications"
    )
    private let keychain = KeychainStore(service: Bundle.main.bundleIdentifier ?? "Cowtail")
    private let defaults = UserDefaults.standard

    private struct NotificationOpenPayload: Sendable {
        let title: String
        let urlString: String?
        let alertID: String?
    }

    enum RegistrationState: String {
        case idle
        case requestingPermission
        case registering
        case registered
        case failed

        var label: String {
            switch self {
            case .idle:
                return "Idle"
            case .requestingPermission:
                return "Requesting permission"
            case .registering:
                return "Registering with APNs"
            case .registered:
                return "Registered"
            case .failed:
                return "Registration failed"
            }
        }
    }

    enum ServerRegistrationState: String {
        case idle
        case waitingForIdentity
        case syncing
        case registered
        case failed

        var label: String {
            switch self {
            case .idle:
                return "Idle"
            case .waitingForIdentity:
                return "Waiting for Apple sign in"
            case .syncing:
                return "Syncing with Cowtail"
            case .registered:
                return "Registered with Cowtail"
            case .failed:
                return "Cowtail registration failed"
            }
        }
    }

    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var registrationState: RegistrationState = .idle
    @Published private(set) var serverRegistrationState: ServerRegistrationState = .idle
    @Published private(set) var deviceToken: String?
    @Published private(set) var registrationError: String?
    @Published private(set) var serverRegistrationMessage: String?
    @Published private(set) var lastNotificationResponse: String?
    @Published private(set) var dailyRoundupEnabled = false
    @Published private(set) var isLoadingDailyRoundupPreference = false
    @Published private(set) var isSavingDailyRoundupPreference = false
    @Published private(set) var dailyRoundupPreferenceError: String?
    @Published private(set) var dailyRoundupPreferenceRequiresSignIn = false
    private var lastSyncedRegistrationKey: String?
    private let deviceTokenKey = "notifications.deviceToken"
    private let syncedUserIDKey = "notifications.syncedUserID"
    private let syncedDeviceTokenKey = "notifications.syncedDeviceToken"
    private let syncedEnvironmentKey = "notifications.syncedEnvironment"
    private var isUITesting = false

    private override init() {
        super.init()
    }

    func configure() {
        isUITesting = false
        UNUserNotificationCenter.current().delegate = self
        deviceToken = persistedString(for: deviceTokenKey)
        if deviceToken != nil {
            registrationState = .registered
        }

        Task {
            await refreshAuthorizationStatus()
            resumeNotificationSetupIfNeeded()
            await syncDeviceRegistration()
        }
    }

    func refreshAuthorizationStatus() async {
        guard !isUITesting else {
            return
        }

        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    func requestAuthorization() {
        registrationState = .requestingPermission
        registrationError = nil

        Task {
            do {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
                await refreshAuthorizationStatus()

                if granted {
                    registerForRemoteNotifications()
                } else {
                    registrationState = .idle
                }
            } catch {
                registrationState = .failed
                registrationError = error.localizedDescription
            }
        }
    }

    func resumeNotificationSetupIfNeeded() {
        guard !isUITesting else {
            return
        }

        guard canRegisterWithAPNs else { return }
        guard deviceToken == nil else { return }
        guard registrationState != .registering else { return }
        registerForRemoteNotifications()
    }

    func registerForRemoteNotifications() {
        registrationState = .registering
        registrationError = nil
        UIApplication.shared.registerForRemoteNotifications()
    }

    func scheduleLocalTestNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Cowtail test notification"
        content.body = "Notification permissions and local delivery are working."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false)
        )

        Task {
            do {
                try await UNUserNotificationCenter.current().add(request)
                lastNotificationResponse = "Queued a local test notification for 3 seconds from now."
            } catch {
                registrationError = error.localizedDescription
            }
        }
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        persist(deviceToken, for: deviceTokenKey)
        registrationState = .registered
        registrationError = nil

        Task {
            await syncDeviceRegistration()
        }
    }

    func didFailToRegister(error: Error) {
        registrationState = .failed
        registrationError = error.localizedDescription
    }

    func resetForUITesting() {
        isUITesting = true
        clearPersistedNotificationState()
        applyUITestState(
            authorizationStatus: .notDetermined,
            registrationState: .idle,
            serverRegistrationState: .idle,
            deviceToken: nil,
            registrationError: nil,
            serverRegistrationMessage: nil,
            dailyRoundupEnabled: false,
            dailyRoundupPreferenceRequiresSignIn: false,
            dailyRoundupPreferenceError: nil
        )
    }

    func seedForUITesting(
        authorizationStatus: UNAuthorizationStatus,
        registrationState: RegistrationState,
        serverRegistrationState: ServerRegistrationState,
        deviceToken: String?,
        registrationError: String?,
        serverRegistrationMessage: String?,
        dailyRoundupEnabled: Bool,
        dailyRoundupPreferenceRequiresSignIn: Bool,
        dailyRoundupPreferenceError: String?
    ) {
        isUITesting = true
        applyUITestState(
            authorizationStatus: authorizationStatus,
            registrationState: registrationState,
            serverRegistrationState: serverRegistrationState,
            deviceToken: deviceToken,
            registrationError: registrationError,
            serverRegistrationMessage: serverRegistrationMessage,
            dailyRoundupEnabled: dailyRoundupEnabled,
            dailyRoundupPreferenceRequiresSignIn: dailyRoundupPreferenceRequiresSignIn,
            dailyRoundupPreferenceError: dailyRoundupPreferenceError
        )
    }

    private func didOpenNotification(_ payload: NotificationOpenPayload) {
        lastNotificationResponse = payload.title
        _ = UniversalLinkRouter.shared.handleNotification(
            urlString: payload.urlString,
            alertID: payload.alertID
        )
    }

    var authorizationLabel: String {
        switch authorizationStatus {
        case .notDetermined:
            return "Not determined"
        case .denied:
            return "Denied"
        case .authorized:
            return "Authorized"
        case .provisional:
            return "Provisional"
        case .ephemeral:
            return "Ephemeral"
        @unknown default:
            return "Unknown"
        }
    }

    var canRegisterWithAPNs: Bool {
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    var isReadyForRemotePush: Bool {
        canRegisterWithAPNs
            && registrationState == .registered
            && serverRegistrationState == .registered
    }

    var friendlyStatusTitle: String {
        if isReadyForRemotePush {
            return "Notifications are ready"
        }

        if AppleAccountManager.shared.userID == nil {
            return "Connect your Apple account"
        }

        if AppleAccountManager.shared.needsFreshIdentityToken() {
            return "Refresh your Apple connection"
        }

        switch authorizationStatus {
        case .notDetermined:
            return "Enable notifications"
        case .denied:
            return "Notifications are turned off"
        case .authorized, .provisional, .ephemeral:
            break
        @unknown default:
            return "Notification setup needs attention"
        }

        switch registrationState {
        case .idle, .requestingPermission:
            return "Finishing device setup"
        case .registering:
            return "Registering this device"
        case .registered:
            break
        case .failed:
            return "Device registration failed"
        }

        switch serverRegistrationState {
        case .idle, .syncing:
            return "Connecting to Cowtail"
        case .waitingForIdentity:
            return "Connect your Apple account"
        case .registered:
            return "Notifications are ready"
        case .failed:
            return "Cowtail sync failed"
        }
    }

    var friendlyStatusMessage: String {
        if isReadyForRemotePush {
            return "Cowtail can send alert notifications to this device."
        }

        if AppleAccountManager.shared.userID == nil {
            return "Sign in with Apple once so Cowtail has a stable identifier for this device."
        }

        if AppleAccountManager.shared.needsFreshIdentityToken() {
            return "Cowtail needs a fresh Apple sign-in before it can verify this device with the backend."
        }

        switch authorizationStatus {
        case .notDetermined:
            return "Allow alerts, badges, and sounds so the app can notify you when new issues land."
        case .denied:
            return "Open Settings and re-enable notifications for Cowtail."
        case .authorized, .provisional, .ephemeral:
            break
        @unknown default:
            return "Notification permissions are in an unknown state."
        }

        switch registrationState {
        case .idle, .requestingPermission:
            return "The app will finish registering with Apple Push Notification service automatically."
        case .registering:
            return "Waiting for Apple Push Notification service to return a device token."
        case .registered:
            break
        case .failed:
            return registrationError ?? "Apple Push Notification service registration failed."
        }

        switch serverRegistrationState {
        case .idle, .syncing:
            return "Syncing your device token to Cowtail."
        case .waitingForIdentity:
            return "Sign in with Apple so Cowtail can attach the device token to your account."
        case .registered:
            return "Cowtail can send alert notifications to this device."
        case .failed:
            return serverRegistrationMessage ?? "Cowtail could not save this device registration."
        }
    }

    func completeSetup() {
        if authorizationStatus == .notDetermined {
            requestAuthorization()
            return
        }

        if canRegisterWithAPNs {
            resumeNotificationSetupIfNeeded()

            Task {
                await syncDeviceRegistration()
            }
        }
    }

    func syncDeviceRegistration() async {
        guard !isUITesting else {
            return
        }

        guard let deviceToken else {
            serverRegistrationState = .idle
            serverRegistrationMessage = nil
            return
        }

        guard let userID = AppleAccountManager.shared.userID else {
            serverRegistrationState = .waitingForIdentity
            serverRegistrationMessage = "Sign in with Apple to attach this device token to a Cowtail identity."
            return
        }

        if hasPersistedServerRegistration(userID: userID, deviceToken: deviceToken) {
            serverRegistrationState = .registered
            serverRegistrationMessage = "Cowtail can send alert notifications to this device."
            return
        }

        guard let identityToken = AppleAccountManager.shared.identityToken, !identityToken.isEmpty else {
            serverRegistrationState = .waitingForIdentity
            serverRegistrationMessage = "Sign in with Apple again to refresh the secure identity token Cowtail needs."
            return
        }

        let registrationKey = "\(identityToken.prefix(24))|\(deviceToken)|\(pushEnvironment)"
        if lastSyncedRegistrationKey == registrationKey, serverRegistrationState == .registered {
            return
        }

        serverRegistrationState = .syncing
        serverRegistrationMessage = nil

        do {
            let response = try await api.registerPushDevice(
                identityToken: identityToken,
                deviceToken: deviceToken,
                environment: pushEnvironment,
                deviceName: UIDevice.current.name
            )

            lastSyncedRegistrationKey = registrationKey
            persistServerRegistration(userID: userID, deviceToken: deviceToken)
            serverRegistrationState = .registered
            serverRegistrationMessage = response.created
                ? "Created Cowtail device registration."
                : "Updated existing Cowtail device registration."
        } catch {
            serverRegistrationState = .failed
            serverRegistrationMessage = userFacingServerError(for: error)
        }
    }

    func unregisterCurrentDevice() async {
        guard let deviceToken else {
            serverRegistrationState = .idle
            serverRegistrationMessage = "No APNs device token is available yet."
            return
        }

        serverRegistrationState = .syncing
        serverRegistrationMessage = nil

        do {
            let response = try await api.unregisterPushDevice(deviceToken: deviceToken)
            lastSyncedRegistrationKey = nil
            clearPersistedServerRegistration()
            serverRegistrationState = .idle
            serverRegistrationMessage = response.updated
                ? "Disabled the Cowtail device registration."
                : "No Cowtail device registration existed for this token."
        } catch {
            serverRegistrationState = .failed
            serverRegistrationMessage = error.localizedDescription
        }
    }

    func appleIdentityDidChange() {
        lastSyncedRegistrationKey = nil
        if AppleAccountManager.shared.userID == nil {
            clearPersistedServerRegistration()
            dailyRoundupEnabled = false
            dailyRoundupPreferenceRequiresSignIn = true
            dailyRoundupPreferenceError = nil
        }
        Task {
            await syncDeviceRegistration()
        }
    }

    func loadDailyRoundupPreference() async {
        guard !isUITesting else {
            return
        }

        print("[roundup-debug] NotificationManager.loadDailyRoundupPreference start userIDPresent=\(AppleAccountManager.shared.userID != nil)")
        logger.debug("loadDailyRoundupPreference start userIDPresent=\(AppleAccountManager.shared.userID != nil, privacy: .public)")
        guard let _ = AppleAccountManager.shared.userID else {
            dailyRoundupEnabled = false
            dailyRoundupPreferenceRequiresSignIn = true
            dailyRoundupPreferenceError = nil
            print("[roundup-debug] NotificationManager.loadDailyRoundupPreference no Apple account")
            logger.debug("loadDailyRoundupPreference no Apple account")
            return
        }

        isLoadingDailyRoundupPreference = true
        dailyRoundupPreferenceError = nil
        defer {
            isLoadingDailyRoundupPreference = false
        }

        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            dailyRoundupPreferenceRequiresSignIn = appSessionManager.sessionState != .refreshing
            print("[roundup-debug] NotificationManager.loadDailyRoundupPreference no session state=\(appSessionManager.sessionState)")
            logger.debug("loadDailyRoundupPreference no session state=\(String(describing: self.appSessionManager.sessionState), privacy: .public)")
            return
        }

        do {
            let preferences = try await api.fetchNotificationPreferences(sessionToken: sessionToken)
            dailyRoundupEnabled = preferences.dailyRoundupEnabled
            dailyRoundupPreferenceRequiresSignIn = false
            print("[roundup-debug] NotificationManager.loadDailyRoundupPreference success enabled=\(preferences.dailyRoundupEnabled)")
            logger.debug("loadDailyRoundupPreference success enabled=\(preferences.dailyRoundupEnabled, privacy: .public)")
        } catch {
            print("[roundup-debug] NotificationManager.loadDailyRoundupPreference failed error=\(error.localizedDescription)")
            logger.error("loadDailyRoundupPreference failed: \(error.localizedDescription, privacy: .public)")
            handleDailyRoundupPreferenceError(error, restoring: dailyRoundupEnabled)
        }
    }

    func updateDailyRoundupEnabled(_ enabled: Bool) async {
        print("[roundup-debug] NotificationManager.updateDailyRoundupEnabled start enabled=\(enabled)")
        logger.debug("updateDailyRoundupEnabled start enabled=\(enabled, privacy: .public)")
        let previousValue = dailyRoundupEnabled
        dailyRoundupEnabled = enabled
        isSavingDailyRoundupPreference = true
        dailyRoundupPreferenceError = nil
        defer {
            isSavingDailyRoundupPreference = false
        }

        if isUITesting {
            dailyRoundupPreferenceRequiresSignIn = false
            return
        }

        guard let _ = AppleAccountManager.shared.userID else {
            dailyRoundupEnabled = previousValue
            dailyRoundupPreferenceRequiresSignIn = true
            print("[roundup-debug] NotificationManager.updateDailyRoundupEnabled no Apple account")
            logger.debug("updateDailyRoundupEnabled no Apple account")
            return
        }

        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            dailyRoundupEnabled = previousValue
            dailyRoundupPreferenceRequiresSignIn = appSessionManager.sessionState != .refreshing
            print("[roundup-debug] NotificationManager.updateDailyRoundupEnabled no session state=\(appSessionManager.sessionState)")
            logger.debug("updateDailyRoundupEnabled no session state=\(String(describing: self.appSessionManager.sessionState), privacy: .public)")
            return
        }

        do {
            let preferences = try await api.updateNotificationPreferences(
                sessionToken: sessionToken,
                dailyRoundupEnabled: enabled
            )
            dailyRoundupEnabled = preferences.dailyRoundupEnabled
            dailyRoundupPreferenceRequiresSignIn = false
            print("[roundup-debug] NotificationManager.updateDailyRoundupEnabled success enabled=\(preferences.dailyRoundupEnabled)")
            logger.debug("updateDailyRoundupEnabled success enabled=\(preferences.dailyRoundupEnabled, privacy: .public)")
        } catch {
            print("[roundup-debug] NotificationManager.updateDailyRoundupEnabled failed error=\(error.localizedDescription)")
            logger.error("updateDailyRoundupEnabled failed: \(error.localizedDescription, privacy: .public)")
            handleDailyRoundupPreferenceError(error, restoring: previousValue)
        }
    }

    private func userFacingServerError(for error: Error) -> String {
        let message = error.localizedDescription

        if message.localizedCaseInsensitiveContains("identityToken and deviceToken are required")
            || message.localizedCaseInsensitiveContains("userId or identityToken is required") {
            return "Cowtail needs a fresh Apple sign-in before it can register this device."
        }

        if message.localizedCaseInsensitiveContains("Invalid Apple identity token format") {
            return "Apple sign-in completed, but the verification token was invalid. Sign in with Apple again."
        }

        if message.localizedCaseInsensitiveContains("Apple identity token verification failed") {
            return "Apple sign-in completed, but Cowtail could not verify the identity token. Sign in with Apple again."
        }

        if message.localizedCaseInsensitiveContains("Apple identity verification is not configured") {
            return "Cowtail is not configured to verify Apple sign-in for push registration."
        }

        if message.localizedCaseInsensitiveContains("Unauthorized") {
            return "Cowtail rejected the registration request. Check the backend auth configuration."
        }

        return "Cowtail could not save this device right now. Please try again."
    }

    private var pushEnvironment: String {
#if DEBUG
        "development"
#else
        "production"
#endif
    }

    private func hasPersistedServerRegistration(userID: String, deviceToken: String) -> Bool {
        persistedString(for: syncedUserIDKey) == userID
            && persistedString(for: syncedDeviceTokenKey) == deviceToken
            && persistedString(for: syncedEnvironmentKey) == pushEnvironment
    }

    private func persistServerRegistration(userID: String, deviceToken: String) {
        persist(userID, for: syncedUserIDKey)
        persist(deviceToken, for: syncedDeviceTokenKey)
        persist(pushEnvironment, for: syncedEnvironmentKey)
    }

    private func clearPersistedServerRegistration() {
        removePersistedValue(for: syncedUserIDKey)
        removePersistedValue(for: syncedDeviceTokenKey)
        removePersistedValue(for: syncedEnvironmentKey)
    }

    private func persistedString(for key: String) -> String? {
        if let value = keychain.string(for: key) {
            return value
        }

        guard let value = defaults.string(forKey: key), !value.isEmpty else {
            return nil
        }

        keychain.set(value, for: key)
        return value
    }

    private func persist(_ value: String?, for key: String) {
        guard let value, !value.isEmpty else {
            removePersistedValue(for: key)
            return
        }

        keychain.set(value, for: key)
        defaults.set(value, forKey: key)
    }

    private func removePersistedValue(for key: String) {
        keychain.remove(key)
        defaults.removeObject(forKey: key)
    }

    private func handleDailyRoundupPreferenceError(_ error: Error, restoring previousValue: Bool) {
        dailyRoundupEnabled = previousValue

        if error.localizedDescription.localizedCaseInsensitiveContains("Unauthorized") {
            appSessionManager.invalidateSession()
            dailyRoundupPreferenceRequiresSignIn = true
            dailyRoundupPreferenceError = "Sign in with Apple again to update your roundup settings."
            return
        }

        dailyRoundupPreferenceRequiresSignIn = false
        dailyRoundupPreferenceError = error.localizedDescription
    }

    private func clearPersistedNotificationState() {
        lastSyncedRegistrationKey = nil
        removePersistedValue(for: deviceTokenKey)
        clearPersistedServerRegistration()
    }

    private func applyUITestState(
        authorizationStatus: UNAuthorizationStatus,
        registrationState: RegistrationState,
        serverRegistrationState: ServerRegistrationState,
        deviceToken: String?,
        registrationError: String?,
        serverRegistrationMessage: String?,
        dailyRoundupEnabled: Bool,
        dailyRoundupPreferenceRequiresSignIn: Bool,
        dailyRoundupPreferenceError: String?
    ) {
        lastSyncedRegistrationKey = nil
        self.authorizationStatus = authorizationStatus
        self.registrationState = registrationState
        self.serverRegistrationState = serverRegistrationState
        self.deviceToken = deviceToken
        self.registrationError = registrationError
        self.serverRegistrationMessage = serverRegistrationMessage
        self.lastNotificationResponse = nil
        self.dailyRoundupEnabled = dailyRoundupEnabled
        self.isLoadingDailyRoundupPreference = false
        self.isSavingDailyRoundupPreference = false
        self.dailyRoundupPreferenceError = dailyRoundupPreferenceError
        self.dailyRoundupPreferenceRequiresSignIn = dailyRoundupPreferenceRequiresSignIn
    }
}

extension NotificationManager: UNUserNotificationCenterDelegate {
    nonisolated private static func notificationOpenPayload(from response: UNNotificationResponse) -> NotificationOpenPayload {
        let userInfo = response.notification.request.content.userInfo

        return NotificationOpenPayload(
            title: response.notification.request.content.title,
            urlString: stringValue(
                for: ["url", "link", "deepLinkURL", "deepLinkUrl", "deep_link_url"],
                in: userInfo
            ),
            alertID: stringValue(for: ["alertId", "alertID", "alert_id"], in: userInfo)
        )
    }

    nonisolated private static func stringValue(
        for keys: [String],
        in userInfo: [AnyHashable: Any]
    ) -> String? {
        for key in keys {
            if let string = userInfo[key] as? String {
                let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }

        return nil
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .badge, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let payload = Self.notificationOpenPayload(from: response)

        await MainActor.run {
            NotificationManager.shared.didOpenNotification(payload)
        }
    }
}
