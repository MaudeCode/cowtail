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
    var active: Bool
    /// Why Alertmanager could not silence the window's alerts.
    var silenceError: String?
}

/// What the owner asks for when starting a window.
struct MaintenanceWindowRequest: Equatable, Sendable {
    var title: String
    var duration: TimeInterval
    var matchers: [MaintenanceWindow.Matcher] = []
    var sources: [String] = []
}
