import AuthenticationServices
import SwiftUI

/// The app's root while no session or Apple identity exists: the Cowtail mark, then Sign in with Apple
/// and the server's OIDC provider, as the `ios-signin` figure draws it.
struct SignInView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var notificationManager: NotificationManager
    @EnvironmentObject private var oidcSignIn: OIDCSignIn

    var body: some View {
        SignInStepLayout {
            VStack(spacing: 10) {
                Text("C")
                    .font(.cowtailSans(34, weight: .bold, relativeTo: .largeTitle))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(palette.accent, in: .rect(cornerRadius: 15))
                    .accessibilityHidden(true)
                Text("Cowtail")
                    .font(.cowtailSans(22, weight: .bold, relativeTo: .title2))
                    .accessibilityAddTraits(.isHeader)
            }
        } actions: {
            AppleSignInButton()
            if let providerName = oidcSignIn.providerName {
                Button {
                    Task {
                        await oidcSignIn.signIn()
                        await notificationManager.syncDeviceRegistration()
                        await notificationManager.loadDailyRoundupPreference()
                    }
                } label: {
                    Text("Sign in with \(providerName)").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(palette.ink)
                .disabled(oidcSignIn.isSigningIn)
                .accessibilityIdentifier("button.sign-in.oidc")
            }
            if let error = appleAccountManager.lastError, appleAccountManager.signInState == .failed {
                SignInError(text: error)
            }
            if let error = oidcSignIn.lastError {
                SignInError(text: error)
            }
        }
        .accessibilityIdentifier("screen.sign-in")
        .task {
            await oidcSignIn.loadProviders()
        }
    }
}

/// The one step after a sign-in: ask for notification permission and register for push, or skip.
struct NotificationStepView: View {
    let done: () -> Void

    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var notificationManager: NotificationManager

    var body: some View {
        SignInStepLayout {
            ContentUnavailableView {
                Label("Turn on notifications", systemImage: "bell")
            } description: {
                Text("Cowtail pushes what needs you now and holds the rest for quiet hours.")
            }
        } actions: {
            Button {
                notificationManager.completeSetup()
                done()
            } label: {
                // The canvas inks its text; the prominent fill takes white, as the system draws it.
                Text("Turn on notifications").foregroundStyle(.white).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("button.notification-step.turn-on")
            Button(action: done) {
                Text("Not now").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .controlSize(.large)
            .accessibilityIdentifier("button.notification-step.not-now")
        }
        .tint(palette.accent)
        .accessibilityIdentifier("screen.notification-step")
    }
}

/// Sign in with Apple, here and in Settings when Apple asks for a fresh confirmation.
struct AppleSignInButton: View {
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var appleAccountManager: AppleAccountManager
    @EnvironmentObject private var appSessionManager: AppSessionManager
    @EnvironmentObject private var notificationManager: NotificationManager

    var body: some View {
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
        .frame(height: 50)
        // A capsule, like the system's large bordered buttons beside it.
        .clipShape(.capsule)
        .accessibilityIdentifier("button.sign-in.apple")
    }
}

/// The sign-in screens' shared frame: content in the upper middle, actions at the bottom.
private struct SignInStepLayout<Content: View, Actions: View>: View {
    @ViewBuilder let content: () -> Content
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        CowtailCanvas {
            VStack(spacing: 0) {
                Spacer()
                content()
                Spacer()
                Spacer()
                VStack(spacing: 10) { actions() }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct SignInError: View {
    @Environment(\.cowtailPalette) private var palette
    let text: String

    var body: some View {
        Text(text)
            .font(.cowtailSans(12, relativeTo: .footnote))
            .foregroundStyle(palette.accent)
    }
}
