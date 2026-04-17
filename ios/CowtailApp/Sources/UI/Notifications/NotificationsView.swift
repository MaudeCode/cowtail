import AuthenticationServices
import SwiftUI

struct NotificationSettingsPanel: View {
    @AppStorage("developerModeEnabled") private var developerModeEnabled = false
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager

    var body: some View {
        VStack(spacing: 16) {
            statusCard

            if developerModeEnabled {
                developerCard
            }
        }
    }

    private var statusCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Notifications")
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: summaryIconName)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(summaryIconColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    Text(summaryTitle)
                        .font(.cowtailSans(20, weight: .bold, relativeTo: .title3))
                        .foregroundStyle(palette.ink)

                    if let summaryMessage {
                        Text(summaryMessage)
                            .font(.cowtailSans(15, relativeTo: .subheadline))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if notificationManager.isReadyForRemotePush {
                HStack(spacing: 10) {
                    compactStateTile(
                        title: "Apple account",
                        value: "Connected",
                        systemImage: "checkmark.seal.fill",
                        tint: palette.moss
                    )

                    compactStateTile(
                        title: "Push alerts",
                        value: "Active",
                        systemImage: "bell.badge.fill",
                        tint: palette.moss
                    )
                }
            } else {
                VStack(spacing: 10) {
                    setupStatusRow(
                        title: "Apple account",
                        value: accountStatusText,
                        systemImage: accountStatusIcon,
                        tint: accountStatusColor
                    )

                    setupStatusRow(
                        title: "Device alerts",
                        value: deviceStatusText,
                        systemImage: deviceStatusIcon,
                        tint: deviceStatusColor
                    )

                    setupStatusRow(
                        title: "Cowtail sync",
                        value: syncStatusText,
                        systemImage: syncStatusIcon,
                        tint: syncStatusColor
                    )
                }
            }

            dailyDigestRow

            if let error = appleAccountManager.lastError, appleAccountManager.signInState == .failed {
                Text(error)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.red)
            }

            if needsAppleAccountConnection {
                appleSignInButton(height: 50)
            }

            if notificationManager.authorizationStatus == .denied {
                Button("Open System Settings") {
                    openSystemSettings()
                }
                .buttonStyle(.borderedProminent)
            } else if requiresAppleConfirmationForPushSetup {
                appleSignInButton(height: 44)
            } else if showsSetupAction {
                Button(primaryActionTitle) {
                    runPrimarySetupAction()
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private var developerCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 16) {
                LabeledContent("Authorization", value: notificationManager.authorizationLabel)
                LabeledContent("APNs registration", value: notificationManager.registrationState.label)
                LabeledContent("Cowtail registration", value: notificationManager.serverRegistrationState.label)

                if let displayName = appleAccountManager.displayName, !displayName.isEmpty {
                    LabeledContent("Name", value: displayName)
                }

                if let email = appleAccountManager.email, !email.isEmpty {
                    LabeledContent("Email", value: email)
                }

                if let userID = appleAccountManager.userID {
                    diagnosticBlock(title: "Apple user identifier", value: userID)
                }

                if let deviceToken = notificationManager.deviceToken {
                    diagnosticBlock(title: "Device token", value: deviceToken)
                }

                if let serverRegistrationMessage = notificationManager.serverRegistrationMessage {
                    diagnosticBlock(title: "Cowtail sync", value: serverRegistrationMessage)
                }

                if let registrationError = notificationManager.registrationError {
                    diagnosticBlock(title: "Last APNs error", value: registrationError, isError: true)
                }

                if let lastNotificationResponse = notificationManager.lastNotificationResponse {
                    LabeledContent("Last notification", value: lastNotificationResponse)
                }

                Button("Refresh status") {
                    Task {
                        await appleAccountManager.refreshCredentialState()
                        _ = await appSessionManager.refreshSessionIfPossible()
                        await notificationManager.refreshAuthorizationStatus()
                        notificationManager.resumeNotificationSetupIfNeeded()
                        await notificationManager.syncDeviceRegistration()
                        await notificationManager.loadDailyDigestPreference()
                    }
                }

                Button("Send local test notification") {
                    notificationManager.scheduleLocalTestNotification()
                }

                Button("Unregister device from Cowtail") {
                    Task {
                        await notificationManager.unregisterCurrentDevice()
                    }
                }

                if appleAccountManager.userID != nil {
                    Button("Forget Apple identity on this device", role: .destructive) {
                        appleAccountManager.clearIdentity()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Text("Developer")
        }
        .groupBoxStyle(CowtailCardStyle())
    }

    private var dailyDigestRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    CowtailMonoLabel(text: CowtailCopy.dailyRoundupTitle, tint: palette.ink)

                    Text(CowtailCopy.dailyRoundupDescription)
                        .font(.cowtailSans(13, relativeTo: .footnote))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Toggle(
                    CowtailCopy.dailyRoundupTitle,
                    isOn: Binding(
                        get: { notificationManager.dailyDigestEnabled },
                        set: { newValue in
                            Task {
                                await notificationManager.updateDailyDigestEnabled(newValue)
                            }
                        }
                    )
                )
                .labelsHidden()
                .disabled(dailyDigestToggleDisabled)
                .overlay(alignment: .center) {
                    if notificationManager.isLoadingDailyDigestPreference || notificationManager.isSavingDailyDigestPreference {
                        ProgressView()
                            .controlSize(.small)
                            .tint(palette.ink)
                            .padding(10)
                            .background(palette.card.opacity(0.92), in: Capsule())
                    }
                }
            }

            if showsDigestReauthenticationButton {
                appleSignInButton(height: 44)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 14)
        .background(palette.cardBorder.opacity(0.35), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func compactStateTile(title: String, value: String, systemImage: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)

            VStack(alignment: .leading, spacing: 2) {
                CowtailMonoLabel(text: title)

                Text(value)
                    .font(.cowtailSans(15, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(palette.ink)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func setupStatusRow(title: String, value: String, systemImage: String, tint: Color) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 2) {
                CowtailMonoLabel(text: title)

                Text(value)
                    .font(.cowtailSans(15, weight: .medium, relativeTo: .subheadline))
                    .foregroundStyle(palette.ink)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(palette.cardBorder.opacity(0.35), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func diagnosticBlock(title: String, value: String, isError: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CowtailMonoLabel(text: title, tint: isError ? .red : nil)

            Text(value)
                .font(.cowtailMono(12, relativeTo: .footnote))
                .textSelection(.enabled)
                .foregroundStyle(isError ? .red : .primary)
        }
    }

    private var requiresAppleConfirmationForPushSetup: Bool {
        appleAccountManager.userID != nil
            && appleAccountManager.needsFreshIdentityToken()
            && notificationManager.serverRegistrationState == .waitingForIdentity
    }

    private var hasSetupError: Bool {
        notificationManager.registrationState == .failed || notificationManager.serverRegistrationState == .failed
    }

    private var dailyDigestToggleDisabled: Bool {
        needsAppleAccountConnection
            || notificationManager.dailyDigestPreferenceRequiresSignIn
            || notificationManager.isLoadingDailyDigestPreference
            || notificationManager.isSavingDailyDigestPreference
    }

    private var showsDigestReauthenticationButton: Bool {
        appleAccountManager.userID != nil
            && notificationManager.dailyDigestPreferenceRequiresSignIn
            && !notificationManager.isLoadingDailyDigestPreference
            && !notificationManager.isSavingDailyDigestPreference
    }

    private var isSyncing: Bool {
        notificationManager.registrationState == .registering || notificationManager.serverRegistrationState == .syncing
    }

    private var showsSetupAction: Bool {
        !notificationManager.isReadyForRemotePush
            && !needsAppleAccountConnection
            && !requiresAppleConfirmationForPushSetup
            && notificationManager.authorizationStatus != .denied
    }

    private var summaryTitle: String {
        if notificationManager.isReadyForRemotePush {
            return "Push alerts ready"
        }

        if needsAppleAccountConnection {
            return "Connect Apple account"
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

        if needsAppleAccountConnection {
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

    private var summaryIconName: String {
        if notificationManager.isReadyForRemotePush {
            return "bell.badge.fill"
        }

        if needsAppleAccountConnection || requiresAppleConfirmationForPushSetup {
            return "person.crop.circle.badge.plus"
        }

        if notificationManager.authorizationStatus == .denied {
            return "bell.slash.fill"
        }

        if hasSetupError {
            return "exclamationmark.triangle.fill"
        }

        if isSyncing {
            return "arrow.triangle.2.circlepath"
        }

        return "bell.badge"
    }

    private var summaryIconColor: Color {
        if notificationManager.isReadyForRemotePush {
            return palette.moss
        }

        if notificationManager.authorizationStatus == .denied {
            return .red
        }

        if hasSetupError {
            return .orange
        }

        return palette.accent
    }

    private var accountStatusText: String {
        if let displayName = appleAccountManager.displayName, !displayName.isEmpty {
            return displayName
        }

        if let email = appleAccountManager.email, !email.isEmpty {
            return email
        }

        if needsAppleAccountConnection {
            return "Sign in with Apple"
        }

        if requiresAppleConfirmationForPushSetup {
            return "Needs confirmation"
        }

        return "Connected"
    }

    private var accountStatusIcon: String {
        if needsAppleAccountConnection {
            return "person.crop.circle.badge.plus"
        }

        if requiresAppleConfirmationForPushSetup {
            return "person.crop.circle.badge.exclamationmark"
        }

        return "checkmark.seal.fill"
    }

    private var accountStatusColor: Color {
        if needsAppleAccountConnection || requiresAppleConfirmationForPushSetup {
            return palette.accent
        }

        return palette.moss
    }

    private var deviceStatusText: String {
        if notificationManager.authorizationStatus == .denied {
            return "Disabled in Settings"
        }

        if notificationManager.authorizationStatus == .notDetermined {
            return "Awaiting approval"
        }

        switch notificationManager.registrationState {
        case .failed:
            return notificationManager.registrationError ?? "APNs registration failed"
        case .registering:
            return "Registering with Apple"
        case .registered:
            return "Device registered"
        case .requestingPermission:
            return "Requesting permission"
        case .idle:
            return "Waiting for registration"
        }
    }

    private var deviceStatusIcon: String {
        if notificationManager.authorizationStatus == .denied {
            return "bell.slash.fill"
        }

        switch notificationManager.registrationState {
        case .failed:
            return "exclamationmark.triangle.fill"
        case .registering, .requestingPermission:
            return "arrow.triangle.2.circlepath"
        case .registered:
            return "checkmark.circle.fill"
        case .idle:
            return "bell.badge"
        }
    }

    private var deviceStatusColor: Color {
        if notificationManager.authorizationStatus == .denied {
            return .red
        }

        switch notificationManager.registrationState {
        case .failed:
            return .orange
        case .registered:
            return palette.moss
        default:
            return palette.accent
        }
    }

    private var syncStatusText: String {
        switch notificationManager.serverRegistrationState {
        case .failed:
            return notificationManager.serverRegistrationMessage ?? "Cowtail could not save this device"
        case .syncing:
            return "Saving this device"
        case .registered:
            return "Connected"
        case .waitingForIdentity:
            return "Waiting for Apple account"
        case .idle:
            return notificationManager.deviceToken == nil ? "Waiting for device token" : "Waiting to sync"
        }
    }

    private var syncStatusIcon: String {
        switch notificationManager.serverRegistrationState {
        case .failed:
            return "exclamationmark.triangle.fill"
        case .syncing:
            return "arrow.triangle.2.circlepath"
        case .registered:
            return "checkmark.circle.fill"
        case .waitingForIdentity:
            return "person.crop.circle.badge.plus"
        case .idle:
            return "externaldrive.badge.icloud"
        }
    }

    private var syncStatusColor: Color {
        switch notificationManager.serverRegistrationState {
        case .failed:
            return .orange
        case .registered:
            return palette.moss
        default:
            return palette.accent
        }
    }

    private var setupErrorText: String {
        if let error = appleAccountManager.lastError, appleAccountManager.signInState == .failed {
            return error
        }

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
            return "Enable Notifications"
        }

        if notificationManager.registrationState == .failed || notificationManager.serverRegistrationState == .failed {
            return "Retry Setup"
        }

        if notificationManager.registrationState != .registered {
            return "Finish Device Registration"
        }

        return "Finish Sync"
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func runPrimarySetupAction() {
        if needsAppleAccountConnection || requiresAppleConfirmationForPushSetup {
            return
        }

        notificationManager.completeSetup()
    }

    private var needsAppleAccountConnection: Bool {
        appleAccountManager.userID == nil
    }

    private func appleSignInButton(height: CGFloat) -> some View {
        SignInWithAppleButton(.continue) { request in
            appleAccountManager.configure(request)
        } onCompletion: { result in
            appleAccountManager.handleCompletion(result)
            Task {
                await refreshAfterAppleSignIn()
            }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: height)
    }

    private func refreshAfterAppleSignIn() async {
        await appleAccountManager.refreshCredentialState()
        _ = await appSessionManager.refreshSessionIfPossible()
        await notificationManager.refreshAuthorizationStatus()
        notificationManager.resumeNotificationSetupIfNeeded()
        await notificationManager.syncDeviceRegistration()
        await notificationManager.loadDailyDigestPreference()
    }
}

struct NotificationSettingsPage: View {
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                    CowtailPageHeader(title: .title("Notifications"))

                    NotificationSettingsPanel()
                }
                .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                .padding(.top, CowtailDesignGuide.pageTopPadding)
                .padding(.bottom, CowtailDesignGuide.pageHorizontalPadding)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await appleAccountManager.refreshCredentialState()
            await notificationManager.refreshAuthorizationStatus()
            notificationManager.resumeNotificationSetupIfNeeded()
            await notificationManager.syncDeviceRegistration()
            _ = await appSessionManager.refreshSessionIfPossible()
            await notificationManager.loadDailyDigestPreference()
        }
    }
}

#Preview {
    NavigationStack {
        NotificationSettingsPage()
        .environmentObject(AppleAccountManager.shared)
        .environmentObject(AppSessionManager.shared)
        .environmentObject(NotificationManager.shared)
    }
}
