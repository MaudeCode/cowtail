import Foundation
import OSLog
import SwiftUI
#if canImport(UIKit)
    import UIKit
#endif
import UserNotifications

@MainActor
final class NotificationManager: NSObject, ObservableObject {
    static let shared = NotificationManager()
    private let api: CowtailAPI
    private let appSessionManager = AppSessionManager.shared
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "notifications"
    )
    private let keychain = KeychainStore(service: Bundle.main.bundleIdentifier ?? "Cowtail")
    private let defaults = UserDefaults.cowtail

    private struct NotificationOpenPayload: Sendable {
        let title: String
        let userInfo: [String: String]
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
                return "Waiting for sign in"
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
    @Published private(set) var preferences = AppNotificationPreferences()
    /// The settings before a change whose outcome the server has not confirmed yet.
    private var unconfirmedPreviousPreferences: AppNotificationPreferences?
    @Published private(set) var isLoadingDailyRoundupPreference = false
    @Published private(set) var isSavingDailyRoundupPreference = false
    @Published private(set) var dailyRoundupPreferenceError: String?
    @Published private(set) var dailyRoundupPreferenceRequiresSignIn = false
    /// Earlier versions kept the APNs token and the last server registration in the keychain,
    /// which outlives a reinstall, and trusted them over APNs and the server.
    private let legacyRegistrationKeys = ["notifications.deviceToken", "notifications.syncedRegistration"]
    private let requireAuthForApprovalsKey = "notifications.requireAuthForApprovals"
    private var isUITesting = false
    private let readAuthorizationStatus: @MainActor () async -> UNAuthorizationStatus
    private let registerWithAPNs: @MainActor () -> Void

    /// Unit tests make their own manager against a recording server, with the system's
    /// notification permission and APNs registration faked.
    init(
        api: CowtailAPI = CowtailAPI(),
        deviceToken: String? = nil,
        authorizationStatus: @escaping @MainActor () async -> UNAuthorizationStatus = {
            await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        },
        registerWithAPNs: @escaping @MainActor () -> Void = {
            #if canImport(UIKit)
                UIApplication.shared.registerForRemoteNotifications()
            #endif
        }
    ) {
        self.api = api
        self.deviceToken = deviceToken
        self.readAuthorizationStatus = authorizationStatus
        self.registerWithAPNs = registerWithAPNs
        super.init()
    }

    /// The name the owner sees for this device in the server's device list.
    private static var deviceName: String {
        #if canImport(UIKit)
            UIDevice.current.name
        #else
            ProcessInfo.processInfo.hostName
        #endif
    }

    func configure() {
        isUITesting = false
        UNUserNotificationCenter.current().delegate = self
        // The last setting the server sent holds until it answers again.
        preferences.requireAuthForApprovals = defaults.bool(forKey: requireAuthForApprovalsKey)
        UNUserNotificationCenter.current().setNotificationCategories(ItemNotifications.categories())

        Task {
            await registerAtLaunch()
            await loadDailyRoundupPreference()
        }
    }

    /// Asks APNs for this run's token and registers it with Cowtail, as every launch does.
    func registerAtLaunch() async {
        clearPersistedNotificationState()
        await refreshAuthorizationStatus()
        resumeNotificationSetupIfNeeded()
        await syncDeviceRegistration()
    }

    var dailyRoundupEnabled: Bool {
        preferences.dailyRoundupEnabled
    }

    /// While a change to the setting is unconfirmed, either value that asks for Face ID wins.
    var requiresApprovalAuthentication: Bool {
        preferences.requireAuthForApprovals
            || unconfirmedPreviousPreferences?.requireAuthForApprovals == true
    }

    private func applyServerPreferences(_ preferences: AppNotificationPreferences) {
        self.preferences = preferences
        unconfirmedPreviousPreferences = nil
        dailyRoundupPreferenceRequiresSignIn = false
        rememberApprovalAuthentication()
    }

    /// Remembers the in-app approval rule, unconfirmed changes included, for the next launch.
    private func rememberApprovalAuthentication() {
        defaults.set(requiresApprovalAuthentication, forKey: requireAuthForApprovalsKey)
    }

    /// Sends a notification action to the item actions endpoint.
    private func performItemAction(
        itemID: String,
        request: ItemActionRequest,
        authenticated: Bool?
    ) async {
        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            lastNotificationResponse = "Sign in with Apple again to act on notifications."
            return
        }

        do {
            _ = try await api.performItemAction(
                itemID: itemID,
                request: request,
                authenticated: authenticated,
                sessionToken: sessionToken
            )
        } catch {
            logger.error("performItemAction failed: \(error.localizedDescription, privacy: .public)")
            lastNotificationResponse = error.localizedDescription
        }
    }

    func refreshAuthorizationStatus() async {
        guard !isUITesting else {
            return
        }

        authorizationStatus = await readAuthorizationStatus()
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
        registerWithAPNs()
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

    func didRegister(deviceToken data: Data) async {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        registrationState = .registered
        registrationError = nil
        await syncDeviceRegistration()
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
            preferences: AppNotificationPreferences(),
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
        preferences: AppNotificationPreferences,
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
            preferences: preferences,
            dailyRoundupPreferenceRequiresSignIn: dailyRoundupPreferenceRequiresSignIn,
            dailyRoundupPreferenceError: dailyRoundupPreferenceError
        )
    }

    private func didOpenNotification(_ payload: NotificationOpenPayload) {
        lastNotificationResponse = payload.title
        _ = UniversalLinkRouter.shared.handleNotification(userInfo: payload.userInfo)
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

    var friendlyStatusMessage: String {
        if isReadyForRemotePush {
            return "Cowtail can send alert notifications to this device."
        }

        if pushUserID == nil {
            return "Sign in once so Cowtail has a stable identifier for this device."
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
            return Self.signInAgainMessage
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

        guard pushUserID != nil else {
            serverRegistrationState = .waitingForIdentity
            serverRegistrationMessage = "Sign in to attach this device token to a Cowtail identity."
            return
        }

        guard let credential = await pushCredential() else {
            serverRegistrationState = .waitingForIdentity
            serverRegistrationMessage = Self.signInAgainMessage
            return
        }

        // Every sync registers: the server upserts, and may have deleted or disabled the device.
        serverRegistrationState = .syncing
        serverRegistrationMessage = nil

        do {
            let response = try await api.registerPushDevice(
                credential: credential,
                deviceToken: deviceToken,
                environment: pushEnvironment,
                deviceName: Self.deviceName
            )

            serverRegistrationState = .registered
            serverRegistrationMessage = response.created
                ? "Created Cowtail device registration."
                : "Updated existing Cowtail device registration."
        } catch {
            // A session the server no longer accepts ends here, so the next sync signs in afresh.
            if case .session = credential, error.localizedDescription.localizedCaseInsensitiveContains("Unauthorized") {
                appSessionManager.invalidateSession()
            }
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

        guard let credential = await pushCredential() else {
            serverRegistrationState = .waitingForIdentity
            serverRegistrationMessage = Self.signInAgainMessage
            return
        }

        if isUITesting {
            serverRegistrationState = .idle
            serverRegistrationMessage = "Disabled the Cowtail device registration."
            return
        }

        serverRegistrationState = .syncing
        serverRegistrationMessage = nil

        do {
            let response = try await api.unregisterPushDevice(
                credential: credential,
                deviceToken: deviceToken
            )
            serverRegistrationState = .idle
            serverRegistrationMessage = response.updated
                ? "Disabled the Cowtail device registration."
                : "No Cowtail device registration existed for this token."
        } catch {
            serverRegistrationState = .failed
            serverRegistrationMessage = error.localizedDescription
        }
    }

    private static let signInAgainMessage = "Sign in again so Cowtail can verify this device."

    /// The session's user when there is a session, else the Apple account's.
    private var pushUserID: String? {
        if appSessionManager.hasValidPersistedSession, let userID = appSessionManager.userID {
            return userID
        }
        return AppleAccountManager.shared.userID
    }

    /// The app session, made from the Apple identity when there is none yet; the Apple
    /// identity token itself when no session can be had.
    private func pushCredential() async -> PushCredential? {
        if let sessionToken = await appSessionManager.refreshSessionIfPossible() {
            return .session(sessionToken)
        }
        if let identityToken = AppleAccountManager.shared.identityToken, !identityToken.isEmpty {
            return .appleIdentity(identityToken)
        }
        return nil
    }

    func appleIdentityDidChange() {
        if AppleAccountManager.shared.userID == nil {
            preferences = AppNotificationPreferences()
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

        // Preferences belong to the session, whichever provider signed in.
        guard AppleAccountManager.shared.userID != nil || appSessionManager.hasValidPersistedSession else {
            preferences = AppNotificationPreferences()
            dailyRoundupPreferenceRequiresSignIn = true
            dailyRoundupPreferenceError = nil
            logger.debug("loadDailyRoundupPreference signed out")
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
            applyServerPreferences(preferences)
            print("[roundup-debug] NotificationManager.loadDailyRoundupPreference success enabled=\(preferences.dailyRoundupEnabled)")
            logger.debug("loadDailyRoundupPreference success enabled=\(preferences.dailyRoundupEnabled, privacy: .public)")
        } catch {
            logger.error("loadDailyRoundupPreference failed")
            handleDailyRoundupPreferenceError(error, restoring: preferences)
        }
    }

    func updateDailyRoundupEnabled(_ enabled: Bool) async {
        var change = NotificationPreferencesChange()
        change.request.dailyRoundupEnabled = enabled
        await updatePreferences(change) { $0.dailyRoundupEnabled = enabled }
    }

    /// Quiet hours run in the device's time zone; nil turns them off.
    func updateQuietHours(_ hours: QuietHours?) async {
        var change = NotificationPreferencesChange()
        if let hours {
            change.request.quietHours = .init(start: hours.start, end: hours.end, timeZone: hours.timeZone)
        } else {
            change.quietHoursOff = true
        }
        await updatePreferences(change) { $0.quietHours = hours }
    }

    func updateRequireAuthForApprovals(_ required: Bool) async {
        var change = NotificationPreferencesChange()
        change.request.requireAuthForApprovals = required
        await updatePreferences(change) { $0.requireAuthForApprovals = required }
    }

    func updateUrgencyOverrides(_ overrides: [String: ItemUrgency]) async {
        var change = NotificationPreferencesChange()
        change.request.urgencyOverrides = .init(
            additionalProperties: overrides.compactMapValues { .init(rawValue: $0.rawValue) }
        )
        await updatePreferences(change) { preferences in
            // Shown at once: kept keys hold their place and a new one goes last until the server
            // orders it.
            let kept = preferences.urgencyOverrideOrder.filter { overrides[$0] != nil }
            preferences.urgencyOverrides = overrides
            preferences.urgencyOverrideOrder = kept + overrides.keys.filter { !kept.contains($0) }.sorted()
        }
    }

    /// Shows the change at once and rolls it back if the server refuses it.
    private func updatePreferences(
        _ change: NotificationPreferencesChange,
        optimistically apply: (inout AppNotificationPreferences) -> Void
    ) async {
        let previous = preferences
        apply(&preferences)
        // Until the server answers, either value that asks for Face ID wins. An earlier
        // unconfirmed write stays unconfirmed until a read from the server settles it.
        let earlierUnconfirmed = unconfirmedPreviousPreferences
        unconfirmedPreviousPreferences = earlierUnconfirmed ?? previous
        rememberApprovalAuthentication()
        isSavingDailyRoundupPreference = true
        dailyRoundupPreferenceError = nil
        defer {
            isSavingDailyRoundupPreference = false
        }

        if isUITesting {
            unconfirmedPreviousPreferences = nil
            dailyRoundupPreferenceRequiresSignIn = false
            return
        }

        guard let sessionToken = await appSessionManager.refreshSessionIfPossible() else {
            preferences = previous
            unconfirmedPreviousPreferences = earlierUnconfirmed
            rememberApprovalAuthentication()
            dailyRoundupPreferenceRequiresSignIn = appSessionManager.sessionState != .refreshing
            logger.debug("updatePreferences has no session")
            return
        }

        do {
            applyServerPreferences(
                try await api.updateNotificationPreferences(sessionToken: sessionToken, change: change)
            )
        } catch CowtailAPIError.refused(let message) {
            logger.error("updatePreferences refused")
            handleDailyRoundupPreferenceError(
                CowtailAPIError.refused(message),
                restoring: Self.reverting(change, in: preferences, to: previous)
            )
            unconfirmedPreviousPreferences = earlierUnconfirmed
            rememberApprovalAuthentication()
        } catch {
            // The change may have landed: read the server before keeping or restoring it.
            logger.error("updatePreferences outcome unknown")
            if let confirmed = try? await api.fetchNotificationPreferences(sessionToken: sessionToken) {
                applyServerPreferences(confirmed)
            } else {
                // Still unconfirmed: the categories keep the stricter setting.
                dailyRoundupPreferenceError = "Cowtail has not confirmed this change yet."
            }
        }
    }

    private func userFacingServerError(for error: Error) -> String {
        let message = error.localizedDescription

        if message.localizedCaseInsensitiveContains("Sign in to register this device for pushes") {
            return Self.signInAgainMessage
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
            return "Cowtail did not accept this sign-in. \(Self.signInAgainMessage)"
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

    /// The current settings with only the fields this change touched put back.
    private static func reverting(
        _ change: NotificationPreferencesChange,
        in current: AppNotificationPreferences,
        to previous: AppNotificationPreferences
    ) -> AppNotificationPreferences {
        var reverted = current
        if change.request.dailyRoundupEnabled != nil {
            reverted.dailyRoundupEnabled = previous.dailyRoundupEnabled
        }
        if change.request.requireAuthForApprovals != nil {
            reverted.requireAuthForApprovals = previous.requireAuthForApprovals
        }
        if change.request.quietHours != nil || change.quietHoursOff {
            reverted.quietHours = previous.quietHours
        }
        if change.request.urgencyOverrides != nil {
            reverted.urgencyOverrides = previous.urgencyOverrides
            reverted.urgencyOverrideOrder = previous.urgencyOverrideOrder
        }
        return reverted
    }

    private func handleDailyRoundupPreferenceError(_ error: Error, restoring previous: AppNotificationPreferences) {
        preferences = previous

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
        for key in legacyRegistrationKeys {
            keychain.remove(key)
            defaults.removeObject(forKey: key)
        }
    }

    private func applyUITestState(
        authorizationStatus: UNAuthorizationStatus,
        registrationState: RegistrationState,
        serverRegistrationState: ServerRegistrationState,
        deviceToken: String?,
        registrationError: String?,
        serverRegistrationMessage: String?,
        preferences: AppNotificationPreferences,
        dailyRoundupPreferenceRequiresSignIn: Bool,
        dailyRoundupPreferenceError: String?
    ) {
        self.authorizationStatus = authorizationStatus
        self.registrationState = registrationState
        self.serverRegistrationState = serverRegistrationState
        self.deviceToken = deviceToken
        self.registrationError = registrationError
        self.serverRegistrationMessage = serverRegistrationMessage
        self.lastNotificationResponse = nil
        self.preferences = preferences
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
            userInfo: stringUserInfo(from: userInfo)
        )
    }

    nonisolated private static func stringUserInfo(from userInfo: [AnyHashable: Any]) -> [String: String] {
        userInfo.reduce(into: [:]) { result, item in
            guard let key = item.key as? String else {
                return
            }

            if let value = item.value as? String {
                result[key] = value
            } else if let value = item.value as? NSNumber {
                result[key] = value.stringValue
            }
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await MainActor.run {
            NotificationCenter.default.post(name: .cowtailPushReceived, object: nil)
        }
        return [.banner, .badge, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let payload = Self.notificationOpenPayload(from: response)
        let request = ItemNotifications.request(
            actionIdentifier: response.actionIdentifier,
            replyText: (response as? UNTextInputNotificationResponse)?.userText,
            now: Date()
        )

        if let request, let itemID = payload.userInfo["itemId"] {
            await NotificationManager.shared.performItemAction(
                itemID: itemID,
                request: request,
                authenticated: request.isApproval
                    ? ItemNotifications.authenticated(
                        categoryIdentifier: response.notification.request.content.categoryIdentifier
                    )
                    : nil
            )
            await MainActor.run {
                NotificationCenter.default.post(name: .cowtailPushReceived, object: nil)
            }
            return
        }

        await MainActor.run {
            NotificationManager.shared.didOpenNotification(payload)
        }
    }
}

extension Notification.Name {
    /// A push arrived or was answered: the app reloads its items.
    static let cowtailPushReceived = Notification.Name("cowtailPushReceived")
}
