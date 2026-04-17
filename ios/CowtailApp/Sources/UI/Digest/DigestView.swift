import SwiftUI

struct DigestView: View {
    let digestRoute: DigestRoute

    @State private var alerts: [AlertItem] = []
    @State private var fixes: [AlertFix] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let api = CowtailAPI()

    private var stats: DigestStats {
        DigestStats(alerts: alerts, fixes: fixes)
    }

    private var groupedAlerts: [AlertOutcome: [AlertItem]] {
        Dictionary(grouping: alerts, by: \.outcome)
    }

    private var timeZone: TimeZone {
        TimeZone(identifier: AppConfig.digestTimeZoneIdentifier) ?? .current
    }

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                    DigestHeroCard(dateRangeText: dateRangeText)
                    DigestSummaryCard(stats: stats)

                    if let errorMessage {
                        errorCard(message: errorMessage)
                    } else if isLoading {
                        loadingCard
                    } else if alerts.isEmpty && fixes.isEmpty {
                        quietDayCard
                    } else {
                        alertSections

                        if !fixes.isEmpty {
                            DigestFixesCard(fixes: fixes)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, CowtailDesignGuide.pageTopPadding)
                .padding(.bottom, 14)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: digestRoute) {
            await loadDigest()
        }
    }

    @ViewBuilder
    private var alertSections: some View {
        ForEach(DigestOutcomeSection.allCases) { section in
            if let items = groupedAlerts[section.outcome], !items.isEmpty {
                DigestOutcomeSectionCard(section: section, alerts: items)
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
            let fromDate = Self.date(from: digestRoute.from, in: timeZone),
            let toDate = Self.date(from: digestRoute.to, in: timeZone)
        else {
            return "\(digestRoute.from) – \(digestRoute.to)"
        }

        let fromText = formatter.string(from: fromDate)
        let toText = formatter.string(from: toDate)
        return fromText == toText ? fromText : "\(fromText) – \(toText)"
    }

    private func loadDigest() async {
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
        }

        guard
            let fromDate = Self.startOfDay(for: digestRoute.from, in: timeZone),
            let toDate = Self.endOfDay(for: digestRoute.to, in: timeZone)
        else {
            errorMessage = "This digest range is invalid."
            return
        }

        if fromDate > toDate {
            errorMessage = "This digest range is invalid."
            return
        }

        do {
            async let alertsTask = api.fetchAlerts(from: fromDate, to: toDate)
            async let fixesTask = api.fetchFixes(from: fromDate, to: toDate)
            alerts = try await alertsTask
            fixes = try await fixesTask
        } catch {
            alerts = []
            fixes = []
            errorMessage = error.localizedDescription
        }
    }

    private static func date(from dateOnly: String, in timeZone: TimeZone) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        let components = dateOnly.split(separator: "-").map(String.init)
        guard components.count == 3,
              let year = Int(components[0]),
              let month = Int(components[1]),
              let day = Int(components[2]) else {
            return nil
        }

        return calendar.date(from: DateComponents(
            timeZone: timeZone,
            year: year,
            month: month,
            day: day,
            hour: 12,
            minute: 0,
            second: 0
        ))
    }

    private static func startOfDay(for dateOnly: String, in timeZone: TimeZone) -> Date? {
        guard let midpoint = date(from: dateOnly, in: timeZone) else {
            return nil
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.startOfDay(for: midpoint)
    }

    private static func endOfDay(for dateOnly: String, in timeZone: TimeZone) -> Date? {
        guard let startOfDay = startOfDay(for: dateOnly, in: timeZone) else {
            return nil
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        guard let nextDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) else {
            return nil
        }

        return nextDay.addingTimeInterval(-1)
    }
}

struct DigestStats {
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

enum DigestOutcomeSection: CaseIterable, Identifiable {
    case escalated
    case fixed
    case selfResolved
    case noise

    var id: String { title }

    var outcome: AlertOutcome {
        switch self {
        case .escalated:
            return .escalated
        case .fixed:
            return .fixed
        case .selfResolved:
            return .selfResolved
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
        DigestView(digestRoute: DigestRoute(from: "2026-04-14", to: "2026-04-14"))
            .environmentObject(CowtailStore())
    }
}
