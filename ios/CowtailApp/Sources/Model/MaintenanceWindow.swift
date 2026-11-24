import Foundation

/// Planned work, as the server reports it. While a window runs, the alerts it covers are
/// silenced in Alertmanager and the items it covers do not push. The server decides whether it
/// covers all alerts and whether it is running.
struct MaintenanceWindow: Identifiable, Equatable, Sendable {
    /// An alert label that must equal `value`.
    struct Matcher: Hashable, Sendable {
        let label: String
        let value: String
    }

    let id: String
    let title: String
    let startsAt: Date
    let endsAt: Date
    var endedAt: Date?
    let matchers: [Matcher]
    /// Item sources it holds back; `*` is every source and `alertmanager` every alert.
    let sources: [String]
    let allAlerts: Bool
    /// The sources it holds back besides alerts; `*` is every source.
    let heldSources: [String]
    var active: Bool
    /// Why Alertmanager could not silence the window's alerts.
    var silenceError: String?
}

/// The running windows, and the sources a new window can hold back, both as the server
/// decides them.
struct MaintenanceWindows: Equatable, Sendable {
    var active: [MaintenanceWindow]
    var sourceChoices: [String]
}

/// What the owner asks for when starting a window. A start retried with the same `requestID`
/// returns the window the first one made.
struct MaintenanceWindowRequest: Equatable, Sendable {
    var title: String
    var duration: TimeInterval
    var matchers: [MaintenanceWindow.Matcher] = []
    var sources: [String] = []
    var requestID = UUID()
}
