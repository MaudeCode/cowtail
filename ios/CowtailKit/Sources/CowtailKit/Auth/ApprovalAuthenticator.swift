import LocalAuthentication

/// Confirms the owner is holding the phone before an in-app approve or deny.
protocol ApprovalAuthenticating: Sendable {
    func authenticate(reason: String) async -> Bool
}

/// Face ID, Touch ID or the passcode, whichever the device offers.
struct DeviceOwnerAuthenticator: ApprovalAuthenticating {
    func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}
