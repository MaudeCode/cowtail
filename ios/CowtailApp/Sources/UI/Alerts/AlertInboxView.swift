import SwiftUI

struct AlertInboxView: View {
    @State private var showsAllNeedsYou = false
    @State private var showsAllInProgress = false
    @State private var showsAllRecent = false
    @EnvironmentObject private var store: CowtailStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    private var needsYouAlerts: [AlertItem] {
        store.alerts.filter { $0.workflowState.needsHumanAttention }
    }

    private var inProgressAlerts: [AlertItem] {
        store.alerts.filter { !$0.workflowState.needsHumanAttention && $0.workflowState.isInProgress }
    }

    private var recentAlerts: [AlertItem] {
        store.alerts.filter { !$0.workflowState.needsHumanAttention && !$0.workflowState.isInProgress }
    }

    private var visibleNeedsYou: [AlertItem] {
        showsAllNeedsYou ? needsYouAlerts : Array(needsYouAlerts.prefix(3))
    }

    private var visibleInProgress: [AlertItem] {
        showsAllInProgress ? inProgressAlerts : Array(inProgressAlerts.prefix(3))
    }

    private var visibleRecent: [AlertItem] {
        showsAllRecent ? recentAlerts : Array(recentAlerts.prefix(8))
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
                    needsYouCount: needsYouAlerts.count,
                    inProgressCount: inProgressAlerts.count
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
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await store.loadIfNeeded()
        }
    }

    @ViewBuilder
    private var alertList: some View {
        if store.alerts.isEmpty, store.isLoading {
            ProgressView("Loading alerts...")
                .frame(maxWidth: .infinity, alignment: .leading)
                .cowtailCard()
        } else if store.alerts.isEmpty, store.errorMessage == nil {
            VStack(alignment: .leading, spacing: 8) {
                Text("No alerts returned")
                    .font(.cowtailSans(17, weight: .semibold, relativeTo: .headline))
                Text("The backend did not return any alerts for the last 7 days.")
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("card.inbox.empty")
            .cowtailCard()
        } else {
            VStack(alignment: .leading, spacing: 18) {
                needsYouSection
                inProgressSection
                recentSection
            }
        }
    }

    private var needsYouSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            InboxSectionHeader(title: "Needs You", detail: "\(needsYouAlerts.count)")

            if needsYouAlerts.isEmpty {
                sectionEmptyState("Nothing needs your decision")
            } else {
                ForEach(visibleNeedsYou) { alert in
                    alertNavigationRow(alert) {
                        PrimaryAlertCard(alert: alert)
                    }
                }

                if needsYouAlerts.count > 3 {
                    InboxSectionToggleButton(
                        isExpanded: showsAllNeedsYou,
                        collapsedTitle: "Show \(needsYouAlerts.count - visibleNeedsYou.count) More",
                        expandedTitle: "Show Fewer"
                    ) {
                        showsAllNeedsYou.toggle()
                    }
                    .accessibilityIdentifier("button.inbox.show-more.needs-you")
                }
            }
        }
    }

    private var inProgressSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            InboxSectionHeader(title: "In Progress", detail: "\(inProgressAlerts.count)")

            if inProgressAlerts.isEmpty {
                sectionEmptyState("No active investigations")
            } else {
                ForEach(visibleInProgress) { alert in
                    alertNavigationRow(alert) {
                        PrimaryAlertCard(alert: alert)
                    }
                }

                if inProgressAlerts.count > 3 {
                    InboxSectionToggleButton(
                        isExpanded: showsAllInProgress,
                        collapsedTitle: "Show \(inProgressAlerts.count - visibleInProgress.count) More",
                        expandedTitle: "Show Fewer"
                    ) {
                        showsAllInProgress.toggle()
                    }
                    .accessibilityIdentifier("button.inbox.show-more.in-progress")
                }
            }
        }
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            InboxSectionHeader(title: "Recent", detail: "\(recentAlerts.count)")

            if recentAlerts.isEmpty {
                sectionEmptyState("No recent completed alerts")
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(visibleRecent.enumerated()), id: \.element.id) { index, alert in
                        alertNavigationRow(alert) {
                            CompactActivityRow(alert: alert)
                        }

                        if index < visibleRecent.count - 1 {
                            Divider().padding(.leading, 42)
                        }
                    }

                    if recentAlerts.count > 8 {
                        Divider().padding(.top, 10)
                        InboxSectionToggleButton(
                            isExpanded: showsAllRecent,
                            collapsedTitle: "Show \(recentAlerts.count - visibleRecent.count) More",
                            expandedTitle: "Show Fewer"
                        ) {
                            showsAllRecent.toggle()
                        }
                        .accessibilityIdentifier("button.inbox.show-more.recent")
                        .padding(.top, 14)
                    }
                }
                .cowtailCard()
            }
        }
    }

    private func sectionEmptyState(_ message: String) -> some View {
        Text(message)
            .font(.cowtailSans(15, relativeTo: .subheadline))
            .foregroundStyle(.secondary)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cowtailCard()
    }

    private func alertNavigationRow<Content: View>(
        _ alert: AlertItem,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Button {
            universalLinkRouter.inboxPath = [.alert(alert.id)]
        } label: {
            content()
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("row.alert.\(alert.id)")
    }

    private func errorCard(message: String) -> some View {
        CowtailCard {
            CowtailSectionHeader(title: "Load Error")
            Text(message)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.red)
        }
        .accessibilityIdentifier("card.inbox.error")
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
            .environmentObject(UniversalLinkRouter.shared)
    }
}
