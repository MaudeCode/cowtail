import SwiftUI

struct RoundupView: View {
    let roundupRoute: RoundupRoute
    @Environment(\.roundupDataClient) private var roundupDataClient

    @State private var alerts: [AlertItem] = []
    @State private var fixes: [AlertFix] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private var stats: RoundupStats {
        RoundupStats(alerts: currentAlerts, fixes: fixes)
    }

    private var groupedAlerts: [AlertOutcome: [AlertItem]] {
        Dictionary(grouping: currentAlerts, by: \.outcome)
    }

    private var currentAlerts: [AlertItem] {
        alerts
    }

    private var timeZone: TimeZone {
        TimeZone(identifier: AppConfig.roundupTimeZoneIdentifier) ?? .current
    }

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                    RoundupHeroCard(dateRangeText: dateRangeText)
                    RoundupSummaryCard(stats: stats)

                    if let errorMessage {
                        errorCard(message: errorMessage)
                    } else if isLoading {
                        loadingCard
                    } else if alerts.isEmpty && fixes.isEmpty {
                        quietDayCard
                    } else {
                        alertSections

                        if !fixes.isEmpty {
                            RoundupFixesCard(fixes: fixes)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, CowtailDesignGuide.pageTopPadding)
                .padding(.bottom, 14)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.roundup")
        .toolbar(.hidden, for: .navigationBar)
        .task(id: roundupRoute) {
            await loadRoundup()
        }
    }

    @ViewBuilder
    private var alertSections: some View {
        ForEach(RoundupOutcomeSection.allCases) { section in
            if let items = groupedAlerts[section.outcome], !items.isEmpty {
                RoundupOutcomeSectionCard(section: section, alerts: items)
            }
        }
    }

    private var loadingCard: some View {
        CowtailCard {
            ProgressView(CowtailCopy.loadingRoundupTitle)
        }
    }

    private var quietDayCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Quiet Day")
            Text("Quiet day")
                .font(.cowtailSans(20, weight: .bold, relativeTo: .title3))

            Text(CowtailCopy.roundupEmptyBody)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("card.roundup.quiet-day")
    }

    private func errorCard(message: String) -> some View {
        CowtailCard {
            CowtailSectionHeader(title: CowtailCopy.roundupUnavailableTitle)
            Text(CowtailCopy.roundupUnavailableBody)
                .font(.cowtailSans(20, weight: .bold, relativeTo: .title3))

            Text(message)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.secondary)
        }
    }

    private var dateRangeText: String {
        let formatter = DateFormatter()
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none

        guard
            let fromDate = RoundupRoute.noon(of: roundupRoute.from, in: timeZone),
            let toDate = RoundupRoute.noon(of: roundupRoute.to, in: timeZone)
        else {
            return "\(roundupRoute.from) – \(roundupRoute.to)"
        }

        let fromText = formatter.string(from: fromDate)
        let toText = formatter.string(from: toDate)
        return fromText == toText ? fromText : "\(fromText) – \(toText)"
    }

    private func loadRoundup() async {
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
        }

        switch await roundupDataClient.loadRoundup(roundupRoute, in: timeZone) {
        case let .loaded(alerts, fixes):
            self.alerts = alerts
            self.fixes = fixes
        case let .failed(message):
            alerts = []
            fixes = []
            errorMessage = message
        }
    }
}

struct RoundupStats {
    let total: Int
    let fixed: Int
    let selfResolved: Int
    let noise: Int
    let escalated: Int
    let fixes: Int

    init(alerts: [AlertItem], fixes: [AlertFix]) {
        self.total = alerts.count
        self.fixed = alerts.filter { $0.outcome == .fixed }.count
        self.selfResolved = alerts.filter { $0.outcome == .selfResolved }.count
        self.noise = alerts.filter { $0.outcome == .noise }.count
        self.escalated = alerts.filter { $0.outcome == .escalated }.count
        self.fixes = fixes.count
    }
}

enum RoundupOutcomeSection: CaseIterable, Identifiable {
    case pending
    case escalated
    case fixed
    case selfResolved
    case recorded
    case noise

    var id: String { accessibilityKey }

    var accessibilityKey: String {
        switch self {
        case .pending:
            return "pending"
        case .escalated:
            return "escalated"
        case .fixed:
            return "fixed"
        case .selfResolved:
            return "self-resolved"
        case .recorded:
            return "recorded"
        case .noise:
            return "noise"
        }
    }

    var outcome: AlertOutcome {
        switch self {
        case .pending:
            return .pending
        case .escalated:
            return .escalated
        case .fixed:
            return .fixed
        case .selfResolved:
            return .selfResolved
        case .recorded:
            return .recorded
        case .noise:
            return .noise
        }
    }

    var title: String {
        outcome.label
    }

    var tint: Color {
        outcome.tint
    }
}

#Preview {
    NavigationStack {
        RoundupView(roundupRoute: RoundupRoute(from: "2026-04-14", to: "2026-04-14"))
    }
}
