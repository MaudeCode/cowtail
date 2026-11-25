import SwiftUI

struct InboxView: View {
    @EnvironmentObject private var store: CowtailStore
    @EnvironmentObject private var router: UniversalLinkRouter
    @Environment(\.cowtailPalette) private var palette
    @State private var isStartingMaintenance = false

    var body: some View {
        CowtailScreen(title: "Inbox", identifier: "screen.inbox") {
            if let health = store.health {
                CowtailStatusBadge(title: "cluster", tint: clusterTint(health), showsDot: true)
                    .accessibilityLabel("Cluster \(health.cephStatus)")
                    .accessibilityIdentifier("chip.inbox.cluster")
            }
            if let hermes = store.hermes {
                let level = hermes.heartbeat?.level
                CowtailStatusBadge(title: "hermes", tint: level?.tint(palette), showsDot: true)
                    .accessibilityLabel("Hermes \(level?.rawValue ?? "not reporting")")
                    .accessibilityIdentifier("chip.inbox.hermes")
            }
        } actions: {
            CowtailIconButton(title: "Start a maintenance window", systemImage: "wrench.adjustable", style: .borderless) {
                isStartingMaintenance = true
            }
            .accessibilityIdentifier("button.inbox.maintenance")
            CowtailIconButton(title: "Settings", systemImage: "gearshape", style: .borderless) {
                router.openSettings()
            }
            .accessibilityIdentifier("button.inbox.settings")
        } content: {
            let inbox = store.inbox ?? .empty

            counts(inbox)

            if let error = store.errorMessage {
                Text(error)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
                    .padding(.top, 8)
                    .accessibilityIdentifier("text.inbox.error")
            }

            ForEach(store.maintenanceWindows) { window in
                MaintenanceBanner(window: window)
            }
            if let error = store.maintenanceError {
                Text(error)
                    .font(.cowtailSans(12, relativeTo: .footnote))
                    .foregroundStyle(palette.accent)
                    .padding(.top, 6)
                    .accessibilityIdentifier("text.maintenance.error")
            }

            section("Needs you", inbox.needsYou, count: inbox.counts.needsYou, style: .needsYou)
            section("Hermes is on it", inbox.withHermes, count: inbox.counts.withHermes, style: .withHermes)
            section("Upcoming", inbox.upcoming, count: inbox.counts.upcoming, style: .upcoming)
        }
        .polling { await store.refresh() }
        .sheet(isPresented: $isStartingMaintenance) {
            MaintenanceSheet()
        }
    }

    private func counts(_ inbox: ItemInbox) -> some View {
        HStack(spacing: 18) {
            count(inbox.counts.needsYou, "need you")
            count(inbox.counts.withHermes, "with Hermes")
            Spacer()
        }
        .padding(.top, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("strip.inbox.counts")
    }

    private func count(_ value: Int, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(value)")
                .font(.cowtailSans(17, weight: .bold, relativeTo: .headline))
                .foregroundStyle(palette.ink)
            Text(label)
                .font(.cowtailSans(12, relativeTo: .caption))
                .foregroundStyle(palette.mutedInk)
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [Item], count: Int, style: ItemRow.Style) -> some View {
        CowtailSectionHeader(title: title, detail: "\(count)")
        ForEach(items) { item in
            ItemRow(item: item, style: style)
        }
    }

    private func clusterTint(_ health: HealthSummary) -> Color {
        switch health.cephStatus {
        case "HEALTH_OK": palette.success
        case "HEALTH_WARN": palette.warning
        default: palette.accent
        }
    }
}

/// Every tab's page and the pages pushed onto it: the navigation bar's title, large on a tab's
/// root and inline once pushed, the page's actions as its toolbar items, then a row of status
/// chips under the title and the sections, on the Cowtail canvas.
struct CowtailScreen<Header: View, Actions: View, Content: View>: View {
    let title: String
    let identifier: String
    var titleDisplayMode: NavigationBarItem.TitleDisplayMode = .large
    @ViewBuilder let header: () -> Header
    @ViewBuilder let actions: () -> Actions
    @ViewBuilder let content: () -> Content

    init(
        title: String,
        identifier: String,
        titleDisplayMode: NavigationBarItem.TitleDisplayMode = .large,
        @ViewBuilder header: @escaping () -> Header = { EmptyView() },
        @ViewBuilder actions: @escaping () -> Actions = { EmptyView() },
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.identifier = identifier
        self.titleDisplayMode = titleDisplayMode
        self.header = header
        self.actions = actions
        self.content = content
    }

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 6) { header() }
                    content()
                }
                .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                .padding(.bottom, 28)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(titleDisplayMode)
        .toolbar {
            if Actions.self != EmptyView.self {
                ToolbarItemGroup(placement: .topBarTrailing) { actions() }
            }
        }
    }
}

extension View {
    /// Loads now and every 30 seconds while the screen is visible; pull to refresh too.
    func polling(_ load: @escaping @MainActor () async -> Void) -> some View {
        refreshable { await load() }
            .task {
                while !Task.isCancelled {
                    await load()
                    try? await Task.sleep(for: .seconds(30))
                }
            }
    }
}
