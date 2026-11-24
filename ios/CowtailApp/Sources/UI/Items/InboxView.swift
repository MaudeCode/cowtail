import SwiftUI

struct InboxView: View {
    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        CowtailScreen(title: "Inbox", identifier: "screen.inbox") {
            if let health = store.health {
                CowtailStatusBadge(title: "cluster", tint: clusterTint(health), showsDot: true)
                    .accessibilityLabel("Cluster \(health.cephStatus)")
            }
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

            section("Needs you", inbox.needsYou, style: .needsYou)
            section("Hermes is on it", inbox.withHermes, style: .withHermes)
            section("Handled · 24h", inbox.handled, style: .handled)
        }
        .polling { await store.refresh() }
    }

    private func counts(_ inbox: ItemInbox) -> some View {
        HStack(spacing: 18) {
            count(inbox.needsYou.count, "need you")
            count(inbox.withHermes.count, "with Hermes")
            count(inbox.handled.count, "handled")
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
    private func section(_ title: String, _ items: [Item], style: ItemRow.Style) -> some View {
        CowtailSectionHeader(title: title, detail: "\(items.count)")
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

/// A tab's page: a title with its chips, then sections, on the Cowtail canvas.
struct CowtailScreen<Accessory: View, Content: View>: View {
    let title: String
    let identifier: String
    @ViewBuilder let accessory: () -> Accessory
    @ViewBuilder let content: () -> Content

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    CowtailPageHeader(title: .title(title)) {
                        HStack(spacing: 6) { accessory() }
                    }
                    content()
                }
                .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                .padding(.top, CowtailDesignGuide.pageTopPadding)
                .padding(.bottom, 28)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
        .toolbar(.hidden, for: .navigationBar)
    }
}

extension CowtailScreen where Accessory == EmptyView {
    init(title: String, identifier: String, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, identifier: identifier, accessory: { EmptyView() }, content: content)
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
