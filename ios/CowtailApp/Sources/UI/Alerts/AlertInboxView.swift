import SwiftUI

struct AlertInboxView: View {
    @State private var showsAllActionableAlerts = false
    @State private var showsAllRecentActivity = false
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: CowtailStore

    private var openCount: Int {
        store.alerts.filter { $0.status == .firing }.count
    }

    private var criticalCount: Int {
        store.alerts.filter { $0.severity == .critical && $0.status == .firing }.count
    }

    private var readyNodesText: String {
        guard let health = store.health else {
            return "--"
        }
        return "\(health.readyNodeCount)/\(health.nodes.count)"
    }

    private var actionableAlerts: [AlertItem] {
        store.alerts.filter { $0.status == .firing && $0.outcome != .noise }
    }

    private var recentActivityAlerts: [AlertItem] {
        store.alerts.filter { !($0.status == .firing && $0.outcome != .noise) }
    }

    private var visibleActionableAlerts: [AlertItem] {
        if showsAllActionableAlerts {
            return actionableAlerts
        }

        return Array(actionableAlerts.prefix(3))
    }

    private var visibleRecentActivityAlerts: [AlertItem] {
        if showsAllRecentActivity {
            return recentActivityAlerts
        }

        return Array(recentActivityAlerts.prefix(8))
    }

    var body: some View {
        CowtailCanvas {
            GeometryReader { geometry in
                ScrollView(.vertical) {
                    VStack(spacing: 20) {
                        if let errorMessage = store.errorMessage {
                            errorCard(message: errorMessage)
                        }

                        metricsGrid
                        clusterCard
                        alertList
                    }
                    .frame(width: max(geometry.size.width - 32, 0), alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
                }
            }
        }
        .navigationTitle("Cowtail")
        .refreshable {
            await store.refresh()
        }
        .task {
            await store.loadIfNeeded()
        }
    }

    private var metricsGrid: some View {
        LazyVGrid(columns: [
            GridItem(.flexible(), spacing: 12),
            GridItem(.flexible(), spacing: 12)
        ], spacing: 12) {
            CowtailMetricTile(value: "\(openCount)", title: "Open Alerts", tint: palette.accent)
            CowtailMetricTile(value: "\(criticalCount)", title: "Critical", tint: .red)
            CowtailMetricTile(value: readyNodesText, title: "Ready Nodes", tint: palette.moss)
            CowtailMetricTile(
                value: store.lastUpdated?.formatted(date: .omitted, time: .shortened) ?? "--",
                title: "Last Refresh",
                tint: palette.storm
            )
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var clusterCard: some View {
        if let health = store.health {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(health.cephStatus)
                            .font(.system(.title3, design: .rounded, weight: .bold))
                        Text(health.cephMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Text("\(health.readyNodeCount)/\(health.nodes.count)")
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(palette.moss)
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Storage")
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text("\(health.storageUsed.formatted(.number.precision(.fractionLength(2)))) / \(health.storageTotal.formatted(.number.precision(.fractionLength(2)))) \(health.storageUnit)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }

                    ProgressView(value: health.storageUsed, total: max(health.storageTotal, 1))
                        .tint(palette.accent)
                }

                if !health.nodes.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Nodes")
                            .font(.subheadline.weight(.semibold))

                        ForEach(health.nodes) { node in
                            HStack {
                                Circle()
                                    .fill(node.isReady ? palette.moss : .red)
                                    .frame(width: 9, height: 9)

                                Text(node.name)
                                    .font(.subheadline)

                                Spacer()

                                Text("CPU \(node.cpu)%")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)

                                Text("MEM \(node.memory)%")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                if let healthErrorMessage = store.healthErrorMessage {
                    Divider()

                    Text(healthErrorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .cowtailCard()
        } else if store.isLoading {
            VStack(alignment: .leading, spacing: 12) {
                ProgressView("Loading cluster health...")
            }
            .cowtailCard()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Cluster health unavailable")
                    .font(.subheadline.weight(.semibold))

                Text(store.healthErrorMessage ?? "Health data is unavailable right now.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .cowtailCard()
        }
    }

    private var alertList: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Alert Inbox")
                .font(.system(.title3, design: .rounded, weight: .bold))

            if store.alerts.isEmpty, store.isLoading {
                VStack(alignment: .leading, spacing: 12) {
                    ProgressView("Loading alerts...")
                }
                .cowtailCard()
            } else if store.alerts.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No alerts returned")
                        .font(.headline)
                    Text("The backend did not return any alerts for the last 7 days.")
                        .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                .cowtailCard()
            } else {
                attentionSection
                recentActivitySection
            }
        }
    }

    private var attentionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(
                title: "Needs Attention",
                detail: actionableAlerts.isEmpty ? "0" : "\(actionableAlerts.count)"
            )

            if actionableAlerts.isEmpty {
                Text("No active alerts")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                .cowtailCard()
            } else {
                ForEach(visibleActionableAlerts) { alert in
                    NavigationLink {
                        AlertDetailView(alert: alert)
                    } label: {
                        AlertRowCard(alert: alert)
                    }
                    .buttonStyle(.plain)
                }

                if actionableAlerts.count > 3 {
                    sectionToggleButton(
                        isExpanded: showsAllActionableAlerts,
                        collapsedTitle: "Show \(actionableAlerts.count - visibleActionableAlerts.count) More Active Alerts",
                        expandedTitle: "Show Fewer Active Alerts"
                    ) {
                        showsAllActionableAlerts.toggle()
                    }
                }
            }
        }
    }

    private var recentActivitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(
                title: "Recent Activity",
                detail: recentActivityAlerts.isEmpty ? "0" : "\(recentActivityAlerts.count)"
            )

            if recentActivityAlerts.isEmpty {
                Text("No recent activity")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                .cowtailCard()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(visibleRecentActivityAlerts.enumerated()), id: \.element.id) { index, alert in
                        NavigationLink {
                            AlertDetailView(alert: alert)
                        } label: {
                            CompactAlertRow(alert: alert)
                        }
                        .buttonStyle(.plain)

                        if index < visibleRecentActivityAlerts.count - 1 {
                            Divider()
                                .padding(.leading, 42)
                        }
                    }

                    if recentActivityAlerts.count > 8 {
                        Divider()
                            .padding(.top, 10)

                        sectionToggleButton(
                            isExpanded: showsAllRecentActivity,
                            collapsedTitle: "Show \(recentActivityAlerts.count - visibleRecentActivityAlerts.count) More Activity Items",
                            expandedTitle: "Show Fewer Activity Items"
                        ) {
                            showsAllRecentActivity.toggle()
                        }
                        .padding(.top, 14)
                    }
                }
                .cowtailCard()
            }
        }
    }

    private func errorCard(message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Load Error")
                .font(.caption.weight(.bold))
                .foregroundStyle(.red)
                .textCase(.uppercase)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
        }
        .cowtailCard()
    }

    private func sectionHeader(title: String, detail: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.headline.weight(.semibold))

            Spacer()

            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func sectionToggleButton(
        isExpanded: Bool,
        collapsedTitle: String,
        expandedTitle: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(isExpanded ? expandedTitle : collapsedTitle)
                    .font(.subheadline.weight(.semibold))
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(palette.accent)
        }
        .buttonStyle(.plain)
    }
}

private struct AlertRowCard: View {
    @Environment(\.cowtailPalette) private var palette
    let alert: AlertItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                AlertClassificationHeader(outcome: alert.outcome)

                Spacer()

                Text(alert.timestamp, style: .relative)
                    .font(.caption)
                    .foregroundStyle(palette.storm.opacity(0.72))
            }

            Text(alert.alertName)
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(palette.ink)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Text(alert.summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Text(alert.sourceLine.isEmpty ? "Unknown source" : alert.sourceLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()
            }
        }
        .cowtailCard()
    }
}

struct AlertClassificationHeader: View {
    let outcome: AlertOutcome

    var body: some View {
        Label(outcome.label, systemImage: outcome.symbolName)
            .font(.caption.weight(.semibold))
            .foregroundStyle(outcome.tint)
    }
}

private struct CompactAlertRow: View {
    @Environment(\.cowtailPalette) private var palette
    let alert: AlertItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: alert.outcome.symbolName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(alert.outcome.tint)
                .frame(width: 24, height: 24)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 12) {
                    Text(alert.alertName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    Text(alert.timestamp, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 8) {
                    Text(alert.outcome.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(alert.outcome.tint)

                    if !alert.sourceLine.isEmpty {
                        Text(alert.sourceLine)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    } else {
                        Text(alert.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
    }
}

#Preview {
    NavigationStack {
        AlertInboxView()
            .environmentObject(CowtailStore())
    }
}
