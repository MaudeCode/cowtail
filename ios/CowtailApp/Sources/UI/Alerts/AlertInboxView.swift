import SwiftUI

struct AlertInboxView: View {
    @State private var showsAllActionableAlerts = false
    @State private var showsAllRecentActivity = false
    @EnvironmentObject private var store: CowtailStore

    private var openCount: Int {
        store.alerts.filter { $0.status == .firing }.count
    }

    private var criticalCount: Int {
        store.alerts.filter { $0.severity == .critical && $0.status == .firing }.count
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
            List {
                InboxHeaderCard(lastUpdated: store.lastUpdated)
                    .listRowInsets(
                        EdgeInsets(
                            top: CowtailDesignGuide.pageTopPadding,
                            leading: 14,
                            bottom: 5,
                            trailing: 14
                        )
                    )
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)

                if let errorMessage = store.errorMessage {
                    errorCard(message: errorMessage)
                        .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 14))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }

                InboxMetricsCard(
                    openCount: openCount,
                    criticalCount: criticalCount
                )
                .accessibilityIdentifier("card.inbox.metrics")
                .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 14))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

                InboxClusterHealthCard(
                    health: store.health,
                    healthErrorMessage: store.healthErrorMessage,
                    isLoading: store.isLoading
                )
                .accessibilityIdentifier("card.inbox.cluster-health")
                .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 14))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

                alertList
                    .padding(.bottom, 18)
                    .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 0, trailing: 14))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.clear)
            .refreshable {
                await store.refresh()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.inbox")
        // Fully hiding the nav bar causes SwiftUI's native refresh control
        // to render offscreen on this screen.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await store.loadIfNeeded()
        }
    }

    private var alertList: some View {
        VStack(alignment: .leading, spacing: 10) {
            if store.alerts.isEmpty, store.isLoading {
                VStack(alignment: .leading, spacing: 12) {
                    ProgressView("Loading alerts...")
                }
                .cowtailCard()
            } else if store.alerts.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No alerts returned")
                        .font(.cowtailSans(17, weight: .semibold, relativeTo: .headline))
                    Text("The backend did not return any alerts for the last 7 days.")
                        .font(.cowtailSans(13, relativeTo: .footnote))
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
        VStack(alignment: .leading, spacing: 8) {
            InboxSectionHeader(title: "Needs Attention", detail: "\(actionableAlerts.count)")

            if actionableAlerts.isEmpty {
                Text("No active alerts")
                    .font(.cowtailSans(15, relativeTo: .subheadline))
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                .cowtailCard()
            } else {
                ForEach(visibleActionableAlerts) { alert in
                    InboxAlertNavigationRow(
                        destination: AlertDetailView(alert: alert),
                        accessibilityIdentifier: "row.alert.\(alert.id)"
                    ) {
                        PrimaryAlertCard(alert: alert)
                    }
                }

                if actionableAlerts.count > 3 {
                    InboxSectionToggleButton(
                        isExpanded: showsAllActionableAlerts,
                        collapsedTitle: "Show \(actionableAlerts.count - visibleActionableAlerts.count) More Active Alerts",
                        expandedTitle: "Show Fewer Active Alerts"
                    ) {
                        showsAllActionableAlerts.toggle()
                    }
                    .accessibilityIdentifier("button.inbox.show-more.active-alerts")
                }
            }
        }
    }

    private var recentActivitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            InboxSectionHeader(title: "Recent Activity", detail: "\(recentActivityAlerts.count)")

            if recentActivityAlerts.isEmpty {
                Text("No recent activity")
                    .font(.cowtailSans(15, relativeTo: .subheadline))
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                .cowtailCard()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(visibleRecentActivityAlerts.enumerated()), id: \.element.id) { index, alert in
                        InboxAlertNavigationRow(
                            destination: AlertDetailView(alert: alert),
                            accessibilityIdentifier: "row.alert.\(alert.id)"
                        ) {
                            CompactActivityRow(alert: alert)
                        }

                        if index < visibleRecentActivityAlerts.count - 1 {
                            Divider()
                                .padding(.leading, 42)
                        }
                    }

                    if recentActivityAlerts.count > 8 {
                        Divider()
                            .padding(.top, 10)

                        InboxSectionToggleButton(
                            isExpanded: showsAllRecentActivity,
                            collapsedTitle: "Show \(recentActivityAlerts.count - visibleRecentActivityAlerts.count) More Activity Items",
                            expandedTitle: "Show Fewer Activity Items"
                        ) {
                            showsAllRecentActivity.toggle()
                        }
                        .accessibilityIdentifier("button.inbox.show-more.recent-activity")
                        .padding(.top, 14)
                    }
                }
                .cowtailCard()
            }
        }
    }

    private func errorCard(message: String) -> some View {
        CowtailCard {
            CowtailSectionHeader(title: "Load Error")
            Text(message)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.red)
        }
    }
}

private struct InboxAlertNavigationRow<Destination: View, Content: View>: View {
    @State private var isActive = false

    let destination: Destination
    let accessibilityIdentifier: String?
    let content: () -> Content

    init(
        destination: Destination,
        accessibilityIdentifier: String? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.destination = destination
        self.accessibilityIdentifier = accessibilityIdentifier
        self.content = content
    }

    var body: some View {
        Button {
            isActive = true
        } label: {
            content()
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier ?? "")
        .background {
            NavigationLink(isActive: $isActive) {
                destination
            } label: {
                EmptyView()
            }
            .hidden()
        }
    }
}

#Preview {
    NavigationStack {
        AlertInboxView()
            .environmentObject(
                CowtailStore(
                    alerts: [CowtailPreviewFixtures.alert, CowtailPreviewFixtures.secondaryAlert],
                    health: CowtailPreviewFixtures.health,
                    fixesByAlertID: [:]
                )
            )
    }
}
