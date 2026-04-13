import AuthenticationServices
import SwiftUI

struct NotificationSettingsPanel: View {
    @AppStorage("developerModeEnabled") private var developerModeEnabled = false
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
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
        VStack(alignment: .leading, spacing: 16) {
            Text("Notifications")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            HStack(alignment: .center, spacing: 14) {
                Image(systemName: summaryIconName)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(summaryIconColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    Text(summaryTitle)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .foregroundStyle(palette.ink)

                    if let summaryMessage {
                        Text(summaryMessage)
                            .font(.subheadline)
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

            if let error = appleAccountManager.lastError, appleAccountManager.signInState == .failed {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            if needsAppleSignIn {
                SignInWithAppleButton(.continue) { request in
                    appleAccountManager.configure(request)
                } onCompletion: { result in
                    appleAccountManager.handleCompletion(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
            }

            if notificationManager.authorizationStatus == .denied {
                Button("Open System Settings") {
                    openSystemSettings()
                }
                .buttonStyle(.borderedProminent)
            } else if showsSetupAction {
                Button(primaryActionTitle) {
                    runPrimarySetupAction()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .cowtailCard()
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
                        await notificationManager.refreshAuthorizationStatus()
                        notificationManager.resumeNotificationSetupIfNeeded()
                        await notificationManager.syncDeviceRegistration()
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

    private func compactStateTile(title: String, value: String, systemImage: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                Text(value)
                    .font(.subheadline.weight(.semibold))
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
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                Text(value)
                    .font(.subheadline.weight(.medium))
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
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(value)
                .font(.footnote.monospaced())
                .textSelection(.enabled)
                .foregroundStyle(isError ? .red : .primary)
        }
    }

    private var needsAppleSignIn: Bool {
        appleAccountManager.userID == nil || appleAccountManager.needsFreshIdentityToken()
    }

    private var hasSetupError: Bool {
        notificationManager.registrationState == .failed || notificationManager.serverRegistrationState == .failed
    }

    private var isSyncing: Bool {
        notificationManager.registrationState == .registering || notificationManager.serverRegistrationState == .syncing
    }

    private var showsSetupAction: Bool {
        !notificationManager.isReadyForRemotePush
            && !needsAppleSignIn
            && notificationManager.authorizationStatus != .denied
    }

    private var summaryTitle: String {
        if notificationManager.isReadyForRemotePush {
            return "Push alerts ready"
        }

        if needsAppleSignIn {
            return appleAccountManager.userID == nil ? "Connect Apple account" : "Confirm Apple sign-in"
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

        if needsAppleSignIn {
            if appleAccountManager.userID == nil {
                return "Sign in once so Cowtail can bind alerts to this device."
            }

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

        if needsAppleSignIn {
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

        if appleAccountManager.userID == nil {
            return "Sign in with Apple"
        }

        if appleAccountManager.needsFreshIdentityToken() {
            return "Needs confirmation"
        }

        return "Connected"
    }

    private var accountStatusIcon: String {
        if appleAccountManager.userID == nil {
            return "person.crop.circle.badge.plus"
        }

        if appleAccountManager.needsFreshIdentityToken() {
            return "person.crop.circle.badge.exclamationmark"
        }

        return "checkmark.seal.fill"
    }

    private var accountStatusColor: Color {
        if appleAccountManager.userID == nil || appleAccountManager.needsFreshIdentityToken() {
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
        if needsAppleSignIn {
            return
        }

        notificationManager.completeSetup()
    }
}

#Preview {
    NavigationStack {
        CowtailCanvas {
            ScrollView {
                NotificationSettingsPanel()
                    .padding()
            }
        }
        .environmentObject(AppleAccountManager.shared)
        .environmentObject(NotificationManager.shared)
    }
}
