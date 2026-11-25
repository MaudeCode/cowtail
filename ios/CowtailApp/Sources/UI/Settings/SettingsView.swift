import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @AppStorage("developerModeEnabled") private var developerModeEnabled = false
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager
    @EnvironmentObject private var themeSettings: ThemeSettings
    @EnvironmentObject private var store: CowtailStore
    @EnvironmentObject private var oidcSignIn: OIDCSignIn

    @State private var isAddingOverride = false

    var body: some View {
        CowtailScreen(title: "Settings", identifier: "screen.settings") {
            account
            notifications
            urgencyOverrides
            appearance
            devices
            developer
            links
        }
        .sheet(isPresented: $isAddingOverride) {
            UrgencyOverrideSheet { key, urgency in
                var overrides = notificationManager.preferences.urgencyOverrides
                overrides[key] = urgency
                Task { await notificationManager.updateUrgencyOverrides(overrides) }
            }
            .presentationDetents([.medium])
        }
        .task {
            await oidcSignIn.loadProviders()
        }
        .task {
            await appleAccountManager.refreshCredentialState()
            await notificationManager.refreshAuthorizationStatus()
            notificationManager.resumeNotificationSetupIfNeeded()
            await notificationManager.syncDeviceRegistration()
            _ = await appSessionManager.refreshSessionIfPossible()
            await notificationManager.loadDailyRoundupPreference()
            await store.loadDevices()
        }
    }

    // MARK: Account

    @ViewBuilder
    private var account: some View {
        CowtailSectionHeader(title: "Account")
        if isSignedIn {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Signed in with \(signInProvider)")
                        .font(.cowtailSans(14, relativeTo: .body))
                        .accessibilityIdentifier("text.settings.signed-in")
                    if signInProvider == AppSessionManager.appleProvider,
                       let name = appleAccountManager.displayName ?? appleAccountManager.email, !name.isEmpty {
                        Text(name)
                            .font(.cowtailSans(12, relativeTo: .caption))
                            .foregroundStyle(palette.mutedInk)
                    }
                }
                Spacer()
                CowtailIconButton(title: "Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    appSessionManager.signOut()
                    appleAccountManager.clearIdentity()
                }
                .accessibilityIdentifier("button.settings.sign-out")
            }
            .cowtailRow()
        } else {
            VStack(spacing: 8) {
                appleSignInButton
                if let providerName = oidcSignIn.providerName {
                    Button {
                        Task {
                            await oidcSignIn.signIn()
                            await notificationManager.syncDeviceRegistration()
                            await notificationManager.loadDailyRoundupPreference()
                            await store.loadDevices()
                        }
                    } label: {
                        Text("Sign in with \(providerName)").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .tint(palette.ink)
                    .disabled(oidcSignIn.isSigningIn)
                    .accessibilityIdentifier("button.settings.oidc-sign-in")
                }
            }
            .cowtailRow()
        }
        if let error = appleAccountManager.lastError, appleAccountManager.signInState == .failed {
            note(error, tint: palette.accent)
        }
        if !isSignedIn, let error = oidcSignIn.lastError {
            note(error, tint: palette.accent)
        }
    }

    // MARK: Notifications

    @ViewBuilder
    private var notifications: some View {
        CowtailSectionHeader(title: "Notifications")
        pushStatus
        if requiresAppleConfirmationForPushSetup {
            appleSignInButton.cowtailRow()
        }
        let preferences = notificationManager.preferences
        toggleRow(
            "Quiet hours",
            detail: "Holds back today pushes. now always pushes.",
            isOn: preferences.quietHours != nil,
            identifier: "toggle.settings.quiet-hours"
        ) { on in
            Task {
                await notificationManager.updateQuietHours(
                    on ? QuietHours(start: "22:00", end: "07:00", timeZone: TimeZone.current.identifier) : nil
                )
            }
        }
        if let hours = preferences.quietHours {
            clockRow("From", time: hours.start, identifier: "picker.settings.quiet-from") { start in
                QuietHours(start: start, end: hours.end, timeZone: TimeZone.current.identifier)
            }
            clockRow("To", time: hours.end, identifier: "picker.settings.quiet-to") { end in
                QuietHours(start: hours.start, end: end, timeZone: TimeZone.current.identifier)
            }
        }
        toggleRow(
            "Require Face ID for approvals",
            isOn: preferences.requireAuthForApprovals,
            identifier: "toggle.settings.require-face-id"
        ) { on in
            Task { @MainActor in
                // Only the device owner turns the protection off.
                if !on, notificationManager.requiresApprovalAuthentication {
                    guard await store.confirmOwner(reason: "Turn off Face ID for approvals.") else { return }
                }
                await notificationManager.updateRequireAuthForApprovals(on)
            }
        }
        toggleRow(
            CowtailCopy.dailyRoundupTitle,
            isOn: preferences.dailyRoundupEnabled,
            identifier: "toggle.notifications.daily-roundup"
        ) { on in
            Task { await notificationManager.updateDailyRoundupEnabled(on) }
        }
        if let error = notificationManager.dailyRoundupPreferenceError {
            note(error, tint: palette.accent)
        }
    }

    private var pushStatus: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(summaryTitle)
                    .font(.cowtailSans(14, weight: .medium, relativeTo: .body))
                    .accessibilityIdentifier("text.notifications.summary-title")
                if let summaryMessage {
                    Text(summaryMessage)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.mutedInk)
                        .accessibilityIdentifier("text.notifications.summary-message")
                }
            }
            Spacer()
            if notificationManager.authorizationStatus == .denied {
                CowtailIconButton(title: "Open System Settings", systemImage: "gearshape") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
                .accessibilityIdentifier("button.notifications.open-settings")
            } else if showsSetupAction {
                CowtailIconButton(title: primaryActionTitle, systemImage: "arrow.clockwise") {
                    notificationManager.completeSetup()
                }
                .accessibilityIdentifier("button.notifications.primary-action")
            }
        }
        .cowtailRow()
    }

    // MARK: Urgency overrides

    @ViewBuilder
    private var urgencyOverrides: some View {
        CowtailSectionHeader(title: "Urgency overrides") {
            CowtailIconButton(title: "Add override", systemImage: "plus", style: .borderless) {
                isAddingOverride = true
            }
            .accessibilityIdentifier("button.settings.add-override")
        }
        let overrides = notificationManager.preferences.urgencyOverrides
        ForEach(notificationManager.preferences.urgencyOverrideOrder, id: \.self) { key in
            HStack {
                Text(key).font(.cowtailMono(13, relativeTo: .footnote))
                Spacer()
                Menu {
                    ForEach(ItemUrgency.allCases) { urgency in
                        Button(urgency.rawValue) {
                            var updated = overrides
                            updated[key] = urgency
                            Task { await notificationManager.updateUrgencyOverrides(updated) }
                        }
                    }
                    Button("Remove", role: .destructive) {
                        var updated = overrides
                        updated[key] = nil
                        Task { await notificationManager.updateUrgencyOverrides(updated) }
                    }
                } label: {
                    if let urgency = overrides[key] {
                        CowtailStatusBadge(title: urgency.rawValue, tint: urgency.tint(palette))
                    }
                }
                .accessibilityLabel("Urgency for \(key)")
            }
            .cowtailRow()
        }
    }

    // MARK: Appearance

    @ViewBuilder
    private var appearance: some View {
        CowtailSectionHeader(title: "Appearance")
        HStack {
            Text("Theme").font(.cowtailSans(14, relativeTo: .body))
            Spacer()
            Picker("Theme", selection: $themeSettings.themeStyle) {
                ForEach(ThemeStyle.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.menu)
            .tint(palette.ink)
        }
        .cowtailRow()
        HStack {
            Text("Mode").font(.cowtailSans(14, relativeTo: .body))
            Spacer()
            Picker("Mode", selection: $themeSettings.appearancePreference) {
                ForEach(ThemeAppearance.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.menu)
            .tint(palette.ink)
        }
        .cowtailRow()
    }

    // MARK: Devices

    @ViewBuilder
    private var devices: some View {
        CowtailSectionHeader(title: "Devices")
        ForEach(store.devices) { device in
            HStack {
                Text(device.name).font(.cowtailSans(14, relativeTo: .body))
                Spacer()
                Text("seen \(ItemFormat.age(of: device.lastSeenAt)) ago")
                    .font(.cowtailMono(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
            }
            .cowtailRow()
        }
    }

    // MARK: Developer and links

    @ViewBuilder
    private var developer: some View {
        CowtailSectionHeader(title: "Developer")
        Toggle("Developer mode", isOn: $developerModeEnabled)
            .font(.cowtailSans(14, relativeTo: .body))
            .cowtailRow()
            .accessibilityIdentifier("toggle.settings.developer-mode")
        if developerModeEnabled {
            diagnostic("Authorization", notificationManager.authorizationLabel)
            diagnostic("APNs registration", notificationManager.registrationState.label)
            diagnostic("Cowtail registration", notificationManager.serverRegistrationState.label)
            if let userID = appleAccountManager.userID {
                diagnostic("Apple user identifier", userID)
            }
            if let deviceToken = notificationManager.deviceToken {
                diagnostic("Device token", deviceToken)
            }
            if let message = notificationManager.serverRegistrationMessage {
                diagnostic("Cowtail sync", message)
            }
            if let error = notificationManager.registrationError {
                diagnostic("Last APNs error", error)
            }
            if let last = notificationManager.lastNotificationResponse {
                diagnostic("Last notification", last)
            }
            HStack(spacing: 8) {
                CowtailIconButton(title: "Refresh status", systemImage: "arrow.clockwise") {
                    Task {
                        await appleAccountManager.refreshCredentialState()
                        _ = await appSessionManager.refreshSessionIfPossible()
                        await notificationManager.refreshAuthorizationStatus()
                        notificationManager.resumeNotificationSetupIfNeeded()
                        await notificationManager.syncDeviceRegistration()
                        await notificationManager.loadDailyRoundupPreference()
                    }
                }
                CowtailIconButton(title: "Send local test notification", systemImage: "bell.badge") {
                    notificationManager.scheduleLocalTestNotification()
                }
                CowtailIconButton(title: "Unregister device from Cowtail", systemImage: "bell.slash") {
                    Task { await notificationManager.unregisterCurrentDevice() }
                }
            }
            .cowtailRow()
        }
    }

    @ViewBuilder
    private var links: some View {
        CowtailSectionHeader(title: "Links")
        link("Public site", url: AppConfig.publicSiteURL)
        link("Convex query endpoint", url: AppConfig.convexQueryURL)
        link("Alert write endpoint", url: AppConfig.alertWriteURL)
        link("Push registration endpoint", url: AppConfig.pushRegistrationURL)
    }

    // MARK: Rows

    private func toggleRow(
        _ title: String,
        detail: String? = nil,
        isOn: Bool,
        identifier: String,
        set: @escaping @Sendable (Bool) -> Void
    ) -> some View {
        Toggle(isOn: Binding(get: { isOn }, set: set)) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.cowtailSans(14, relativeTo: .body))
                if let detail {
                    Text(detail)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.mutedInk)
                }
            }
        }
        .disabled(preferencesLocked)
        .accessibilityIdentifier(identifier)
        .cowtailRow()
    }

    private func clockRow(
        _ title: String,
        time: String,
        identifier: String,
        hours: @escaping (String) -> QuietHours
    ) -> some View {
        DatePicker(
            title,
            selection: Binding(
                get: { Self.date(fromClock: time) },
                set: { date in
                    Task { await notificationManager.updateQuietHours(hours(Self.clock(from: date))) }
                }
            ),
            displayedComponents: .hourAndMinute
        )
        .font(.cowtailSans(14, relativeTo: .body))
        .disabled(preferencesLocked)
        .accessibilityIdentifier(identifier)
        .cowtailRow()
    }

    private func diagnostic(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            CowtailMonoLabel(text: title)
            Text(value)
                .font(.cowtailMono(12, relativeTo: .footnote))
                .textSelection(.enabled)
        }
        .cowtailRow()
    }

    private func link(_ title: String, url: URL) -> some View {
        Link(destination: url) {
            HStack {
                Text(title).font(.cowtailSans(14, relativeTo: .body))
                Spacer()
                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(palette.ink)
        }
        .cowtailRow()
    }

    private func note(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.cowtailSans(12, relativeTo: .footnote))
            .foregroundStyle(tint)
            .padding(.vertical, 4)
    }

    private var appleSignInButton: some View {
        SignInWithAppleButton(.signIn) { request in
            appleAccountManager.configure(request)
        } onCompletion: { result in
            appleAccountManager.handleCompletion(result)
            Task {
                await appleAccountManager.refreshCredentialState()
                _ = await appSessionManager.refreshSessionIfPossible()
                await notificationManager.refreshAuthorizationStatus()
                notificationManager.resumeNotificationSetupIfNeeded()
                await notificationManager.syncDeviceRegistration()
                await notificationManager.loadDailyRoundupPreference()
            }
        }
        // Black on a light screen and white on a dark one, as Apple's guidelines and the figure draw it.
        .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
        .frame(height: 44)
        .accessibilityIdentifier("button.notifications.apple-sign-in")
    }

    // MARK: Clock times

    private static func date(fromClock clock: String) -> Date {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        var components = Calendar.current.dateComponents([.year, .month, .day], from: .now)
        components.hour = parts.first
        components.minute = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(from: components) ?? .now
    }

    private static func clock(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }

    // MARK: Push setup state

    private var preferencesLocked: Bool {
        !isSignedIn
            || notificationManager.dailyRoundupPreferenceRequiresSignIn
            || notificationManager.isLoadingDailyRoundupPreference
            // One settings write at a time, so a refusal never meets a newer change.
            || notificationManager.isSavingDailyRoundupPreference
    }

    private var isSignedIn: Bool {
        appleAccountManager.userID != nil || appSessionManager.hasValidPersistedSession
    }

    private var signInProvider: String {
        appSessionManager.provider ?? AppSessionManager.appleProvider
    }

    /// Offers Sign in with Apple under Notifications when an Apple account has neither a session
    /// nor a fresh identity token to register the device with. Any session registers it.
    private var requiresAppleConfirmationForPushSetup: Bool {
        appleAccountManager.userID != nil
            && appleAccountManager.needsFreshIdentityToken()
            && notificationManager.serverRegistrationState == .waitingForIdentity
    }

    private var hasSetupError: Bool {
        notificationManager.registrationState == .failed || notificationManager.serverRegistrationState == .failed
    }

    private var isSyncing: Bool {
        notificationManager.registrationState == .registering || notificationManager.serverRegistrationState == .syncing
    }

    private var showsSetupAction: Bool {
        !notificationManager.isReadyForRemotePush
            && isSignedIn
            && !requiresAppleConfirmationForPushSetup
            && notificationManager.authorizationStatus != .denied
    }

    private var summaryTitle: String {
        if notificationManager.isReadyForRemotePush {
            return "Push alerts ready"
        }
        if !isSignedIn {
            return "Sign in for push alerts"
        }
        if requiresAppleConfirmationForPushSetup {
            return "Confirm Apple sign-in"
        }
        if notificationManager.authorizationStatus == .denied {
            return "Notifications are off"
        }
        if hasSetupError {
            return "Push setup needs attention"
        }
        if isSyncing {
            return "Finishing push setup"
        }
        if notificationManager.authorizationStatus == .notDetermined {
            return "Allow notifications"
        }
        return "Finish push setup"
    }

    private var summaryMessage: String? {
        if notificationManager.isReadyForRemotePush {
            return nil
        }
        if !isSignedIn {
            return "Sign in once so Cowtail can bind alerts to this device."
        }
        if requiresAppleConfirmationForPushSetup {
            return "Apple needs a fresh confirmation before Cowtail can verify this device."
        }
        if notificationManager.authorizationStatus == .denied {
            return "Turn notifications back on in Settings."
        }
        if hasSetupError {
            return setupErrorText
        }
        if isSyncing {
            return "Apple and Cowtail are finishing device registration."
        }
        if notificationManager.authorizationStatus == .notDetermined {
            return "Allow alerts, badges, and sounds to continue."
        }
        return "This device still needs one more setup step."
    }

    private var setupErrorText: String {
        if notificationManager.registrationState == .failed {
            return notificationManager.registrationError ?? "Apple push registration failed."
        }
        if notificationManager.serverRegistrationState == .failed {
            return notificationManager.serverRegistrationMessage ?? "Cowtail could not save this device."
        }
        return notificationManager.friendlyStatusMessage
    }

    private var primaryActionTitle: String {
        if notificationManager.authorizationStatus == .notDetermined {
            return "Enable notifications"
        }
        if hasSetupError {
            return "Retry setup"
        }
        if notificationManager.registrationState != .registered {
            return "Finish device registration"
        }
        return "Finish sync"
    }
}

/// Adds a `source` or `source:kind` key with its urgency.
struct UrgencyOverrideSheet: View {
    let add: (String, ItemUrgency) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var urgency = ItemUrgency.whenever

    var body: some View {
        NavigationStack {
            Form {
                TextField("source or source:kind", text: $key)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.cowtailMono(14, relativeTo: .body))
                    .accessibilityIdentifier("field.settings.override-key")
                Picker("Urgency", selection: $urgency) {
                    ForEach(ItemUrgency.allCases) { Text($0.rawValue).tag($0) }
                }
            }
            .navigationTitle("Urgency override")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        add(key.trimmingCharacters(in: .whitespaces).lowercased(), urgency)
                        dismiss()
                    }
                    .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("button.settings.override-save")
                }
            }
        }
    }
}
