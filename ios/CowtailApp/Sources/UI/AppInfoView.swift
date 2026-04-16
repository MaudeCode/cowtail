import SwiftUI

struct AppInfoView: View {
    @AppStorage("developerModeEnabled") private var developerModeEnabled = false
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager
    @EnvironmentObject private var themeSettings: ThemeSettings

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: 20) {
                    notificationsCard
                    preferencesCard
                    endpointsCard
                }
                .padding(.horizontal)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("Settings")
        .task {
            await appleAccountManager.refreshCredentialState()
            await notificationManager.refreshAuthorizationStatus()
            notificationManager.resumeNotificationSetupIfNeeded()
            await notificationManager.syncDeviceRegistration()
            _ = await appSessionManager.refreshSessionIfPossible()
            await notificationManager.loadDailyDigestPreference()
        }
    }

    private var notificationsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Notifications")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            NavigationLink {
                NotificationSettingsPage()
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: notificationManager.isReadyForRemotePush ? "bell.badge.fill" : "bell.badge")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(
                            notificationManager.isReadyForRemotePush ? palette.moss : palette.accent,
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )

                    VStack(alignment: .leading, spacing: 4) {
                        Text(notificationManager.friendlyStatusTitle)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(palette.ink)

                        Text(notificationManager.dailyDigestEnabled ? "Daily digest enabled" : "Daily digest disabled")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
        }
        .cowtailCard()
    }

    private var preferencesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Preferences")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            VStack(alignment: .leading, spacing: 8) {
                Text("Theme")
                    .font(.subheadline.weight(.semibold))

                Picker(
                    "Theme",
                    selection: Binding(
                        get: { themeSettings.themeStyle },
                        set: { themeSettings.themeStyle = $0 }
                    )
                ) {
                    ForEach(ThemeStyle.allCases) { theme in
                        Text(theme.title).tag(theme)
                    }
                }
                .pickerStyle(.menu)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Appearance")
                    .font(.subheadline.weight(.semibold))

                Picker(
                    "Appearance",
                    selection: Binding(
                        get: { themeSettings.appearancePreference },
                        set: { themeSettings.appearancePreference = $0 }
                    )
                ) {
                    ForEach(ThemeAppearance.allCases) { appearance in
                        Text(appearance.title).tag(appearance)
                    }
                }
                .pickerStyle(.segmented)
            }

            Divider()

            Toggle("Developer mode", isOn: $developerModeEnabled)
                .toggleStyle(.switch)
        }
        .cowtailCard()
    }

    private var endpointsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Links")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            settingsLink("Public site", url: AppConfig.publicSiteURL, systemImage: "globe")
            settingsLink("Convex query endpoint", url: AppConfig.convexQueryURL, systemImage: "externaldrive.connected.to.line.below")
            settingsLink("Alert write endpoint", url: AppConfig.alertWriteURL, systemImage: "square.and.arrow.up")
            settingsLink("Push registration endpoint", url: AppConfig.pushRegistrationURL, systemImage: "bell.badge.fill")
        }
        .cowtailCard()
    }

    private func settingsLink(_ title: String, url: URL, systemImage: String) -> some View {
        Link(destination: url) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
            }
            .font(.subheadline)
        }
    }
}

#Preview {
    NavigationStack {
        AppInfoView()
            .environmentObject(AppleAccountManager.shared)
            .environmentObject(AppSessionManager.shared)
            .environmentObject(NotificationManager.shared)
            .environmentObject(ThemeSettings())
    }
}
