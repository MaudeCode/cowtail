import SwiftUI

struct FarmhouseView: View {
    @AppStorage("developerModeEnabled") private var developerModeEnabled = false
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager
    @EnvironmentObject private var openClawStore: OpenClawStore
    @EnvironmentObject private var themeSettings: ThemeSettings
    @FocusState private var openClawNameIsFocused: Bool
    @State private var openClawDisplayNameDraft = ""
    @State private var openClawNameIsSaving = false
    @State private var openClawNameStatus: String?

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
        .accessibilityIdentifier("screen.farmhouse")
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            syncOpenClawDisplayNameDraft()
        }
        .onChange(of: openClawStore.displayName) {
            guard !openClawNameIsFocused, !openClawNameIsSaving else { return }
            syncOpenClawDisplayNameDraft(clearStatus: false)
        }
        .task {
            await appleAccountManager.refreshCredentialState()
            await notificationManager.refreshAuthorizationStatus()
            notificationManager.resumeNotificationSetupIfNeeded()
            await notificationManager.syncDeviceRegistration()
            _ = await appSessionManager.refreshSessionIfPossible()
            await notificationManager.loadDailyRoundupPreference()
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

                        Text(notificationManager.dailyRoundupEnabled ? CowtailCopy.dailyRoundupEnabled : CowtailCopy.dailyRoundupDisabled)
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
            .accessibilityIdentifier("card.farmhouse.notifications")
        }
    }

    private var preferencesCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Preferences")
            openClawNameSettings

            Divider()

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
                .accessibilityIdentifier("toggle.farmhouse.developer-mode")
        }
    }

    private var openClawNameSettings: some View {
        VStack(alignment: .leading, spacing: 8) {
            CowtailMonoLabel(text: "OpenClaw name", tint: palette.ink)

            HStack(spacing: 10) {
                TextField("OpenClaw", text: $openClawDisplayNameDraft)
                    .textInputAutocapitalization(.words)
                    .disableAutocorrection(true)
                    .focused($openClawNameIsFocused)
                    .submitLabel(.done)
                    .font(.cowtailSans(15, relativeTo: .subheadline))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        palette.surfaceRaised,
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(palette.border, lineWidth: 1)
                    )
                    .accessibilityIdentifier("field.farmhouse.openclaw-name")
                    .accessibilityLabel("OpenClaw name")
                    .onSubmit {
                        saveOpenClawDisplayName()
                    }

                Button {
                    saveOpenClawDisplayName()
                } label: {
                    if openClawNameIsSaving {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Save")
                            .font(.cowtailSans(14, weight: .semibold, relativeTo: .callout))
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSaveOpenClawDisplayName)
                .accessibilityIdentifier("button.farmhouse.openclaw-name.save")
            }

            if let openClawNameStatus {
                Text(openClawNameStatus)
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("text.farmhouse.openclaw-name.status")
            }
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

    private var effectiveOpenClawDisplayName: String {
        let displayName = openClawStore.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return displayName.isEmpty ? "OpenClaw" : displayName
    }

    private var trimmedOpenClawDisplayNameDraft: String {
        openClawDisplayNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSaveOpenClawDisplayName: Bool {
        !openClawNameIsSaving
            && !trimmedOpenClawDisplayNameDraft.isEmpty
            && trimmedOpenClawDisplayNameDraft != effectiveOpenClawDisplayName
    }

    private func syncOpenClawDisplayNameDraft(clearStatus: Bool = true) {
        openClawDisplayNameDraft = effectiveOpenClawDisplayName
        if clearStatus {
            openClawNameStatus = nil
        }
    }

    private func saveOpenClawDisplayName() {
        guard canSaveOpenClawDisplayName else { return }

        let displayName = trimmedOpenClawDisplayNameDraft
        openClawNameIsFocused = false
        openClawNameIsSaving = true
        openClawNameStatus = nil

        Task {
            let saved = await openClawStore.updateDisplayName(displayName)
            openClawDisplayNameDraft = saved ? effectiveOpenClawDisplayName : displayName
            openClawNameStatus = saved ? "Saved" : openClawStore.errorMessage ?? "Unable to save name."
            openClawNameIsSaving = false
        }
    }
}

#Preview {
    NavigationStack {
        FarmhouseView()
            .environmentObject(AppleAccountManager.shared)
            .environmentObject(AppSessionManager.shared)
            .environmentObject(NotificationManager.shared)
            .environmentObject(CowtailPreviewFixtures.openClawStore())
            .environmentObject(ThemeSettings())
    }
}
