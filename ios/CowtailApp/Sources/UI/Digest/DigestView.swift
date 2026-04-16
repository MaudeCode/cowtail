import SwiftUI

struct DigestView: View {
    @Environment(\.cowtailPalette) private var palette

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
                VStack(spacing: 20) {
                    heroCard
                    metricsCard

                    if let errorMessage {
                        errorCard(message: errorMessage)
                    } else if isLoading {
                        loadingCard
                    } else if alerts.isEmpty && fixes.isEmpty {
                        quietDayCard
                    } else {
                        alertSections

                        if !fixes.isEmpty {
                            fixesCard
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("Daily Digest")
        .navigationBarTitleDisplayMode(.large)
        .task(id: digestRoute) {
            await loadDigest()
        }
    }

    private var heroCard: some View {
        CowtailHeroCard(gradient: palette.heroGradient) {
            Text("Cowtail Daily Digest")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(.white)

            Text(dateRangeText)
                .font(.body)
                .foregroundStyle(.white.opacity(0.84))

            Text(summaryText)
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.74))
        }
    }

    private var metricsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Summary")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ],
                spacing: 12
            ) {
                CowtailMetricTile(value: "\(stats.total)", title: "Alerts", tint: palette.accent)
                CowtailMetricTile(value: "\(stats.fixed)", title: "Fixed", tint: .green)
                CowtailMetricTile(value: "\(stats.selfResolved)", title: "Self-Res.", tint: .mint)
                CowtailMetricTile(value: "\(stats.escalated)", title: "Escalated", tint: .orange)
                CowtailMetricTile(value: "\(stats.noise)", title: "Noise", tint: palette.storm)
                CowtailMetricTile(value: "\(stats.fixes)", title: "Fixes", tint: .blue)
            }
        }
        .cowtailCard()
    }

    @ViewBuilder
    private var alertSections: some View {
        ForEach(DigestOutcomeSection.allCases) { section in
            if let items = groupedAlerts[section.outcome], !items.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text(section.title)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(palette.storm.opacity(0.75))
                            .textCase(.uppercase)

                        Spacer()

                        Text("\(items.count)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(section.tint)
                    }

                    ForEach(items.sorted(by: { $0.timestamp < $1.timestamp })) { alert in
                        NavigationLink {
                            AlertDetailView(alert: alert)
                        } label: {
                            DigestAlertRow(alert: alert)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .cowtailCard()
            }
        }
    }

    private var fixesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Fixes Applied")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(palette.storm.opacity(0.75))
                    .textCase(.uppercase)

                Spacer()

                Text("\(fixes.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.blue)
            }

            ForEach(Array(fixes.sorted(by: { $0.timestamp < $1.timestamp }).enumerated()), id: \.element.id) { index, fix in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        DigestScopeBadge(scope: fix.scope)

                        Spacer()

                        Text(fix.timestamp.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(fix.description)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.ink)

                    if !fix.rootCause.isEmpty {
                        Text(fix.rootCause)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if index < fixes.count - 1 {
                    Divider()
                }
            }
        }
        .cowtailCard()
    }

    private var loadingCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            ProgressView("Loading digest...")
        }
        .cowtailCard()
    }

    private var quietDayCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Quiet day")
                .font(.system(.title3, design: .rounded, weight: .bold))

            Text("No alerts fired and no fixes were recorded in this digest window.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .cowtailCard()
    }

    private func errorCard(message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Digest unavailable")
                .font(.system(.title3, design: .rounded, weight: .bold))

            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .cowtailCard()
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

    private var summaryText: String {
        if stats.total == 0 {
            return stats.fixes == 0
                ? "No alerts fired. Quiet day."
                : "No alerts fired, \(stats.fixes) fix\(stats.fixes == 1 ? "" : "es") shipped."
        }

        var segments = [
            "\(stats.total) alert\(stats.total == 1 ? "" : "s")",
            "\(stats.fixed) fixed",
            "\(stats.selfResolved) self-resolved",
            "\(stats.escalated) escalated"
        ]

        if stats.fixes > 0 {
            segments.append("\(stats.fixes) fix\(stats.fixes == 1 ? "" : "es") shipped")
        }

        return segments.joined(separator: ", ")
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

private struct DigestStats {
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

private enum DigestOutcomeSection: CaseIterable, Identifiable {
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

private struct DigestAlertRow: View {
    @Environment(\.cowtailPalette) private var palette

    let alert: AlertItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                AlertClassificationHeader(outcome: alert.outcome)

                Spacer()

                Text(alert.timestamp.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(palette.storm.opacity(0.72))
            }

            Text(alert.alertName)
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(palette.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(alert.summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !alert.sourceLine.isEmpty {
                Text(alert.sourceLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct DigestScopeBadge: View {
    let scope: FixScope

    var body: some View {
        Text(scope.label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(scope.tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(scope.tint.opacity(0.14), in: Capsule())
    }
}

#Preview {
    NavigationStack {
        DigestView(digestRoute: DigestRoute(from: "2026-04-14", to: "2026-04-14"))
            .environmentObject(CowtailStore())
    }
}
