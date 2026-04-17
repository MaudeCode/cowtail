import SwiftUI

struct FarmhouseView: View {
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
                    CowtailPageHeader(title: .split(leading: CowtailCopy.farmhouseBrandLeading, trailing: CowtailCopy.farmhouseBrandTrailing))
                    notificationsCard
                    preferencesCard
                    endpointsCard
                }
                .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                .padding(.top, CowtailDesignGuide.pageTopPadding)
                .padding(.bottom, 28)
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

    private var notificationsCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Notifications")
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
                            .font(.cowtailSans(15, weight: .semibold, relativeTo: .subheadline))
                            .foregroundStyle(palette.ink)

                        Text(notificationManager.dailyDigestEnabled ? CowtailCopy.dailyRoundupEnabled : CowtailCopy.dailyRoundupDisabled)
                            .font(.cowtailSans(13, relativeTo: .footnote))
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
    }

    private var preferencesCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Preferences")
            VStack(alignment: .leading, spacing: 8) {
                CowtailMonoLabel(text: "Theme", tint: palette.ink)

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
                CowtailMonoLabel(text: "Appearance", tint: palette.ink)

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
    }

    private var endpointsCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Links")
            settingsLink("Public site", url: AppConfig.publicSiteURL, systemImage: "globe")
            settingsLink("Convex query endpoint", url: AppConfig.convexQueryURL, systemImage: "externaldrive.connected.to.line.below")
            settingsLink("Alert write endpoint", url: AppConfig.alertWriteURL, systemImage: "square.and.arrow.up")
            settingsLink("Push registration endpoint", url: AppConfig.pushRegistrationURL, systemImage: "bell.badge.fill")
        }
    }

    private func settingsLink(_ title: String, url: URL, systemImage: String) -> some View {
        Link(destination: url) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
            }
            .font(.cowtailSans(15, relativeTo: .subheadline))
        }
    }
}

#Preview {
    NavigationStack {
        FarmhouseView()
            .environmentObject(AppleAccountManager.shared)
            .environmentObject(AppSessionManager.shared)
            .environmentObject(NotificationManager.shared)
            .environmentObject(ThemeSettings())
    }
}
