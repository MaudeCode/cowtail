import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            await NotificationManager.shared.didRegister(deviceToken: deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            NotificationManager.shared.didFailToRegister(error: error)
        }
    }

    /// Items stopped being live: the badge and their delivered notifications follow at once.
    /// iOS throttles these pushes; the inbox load on every return to the foreground covers them.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard let push = ItemSyncPush(userInfo: userInfo) else { return .noData }
        await push.apply(in: SystemNotificationCenter())
        return .newData
    }
}
