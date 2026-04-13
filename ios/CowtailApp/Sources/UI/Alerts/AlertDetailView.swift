import SwiftUI

struct AlertDetailView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: CowtailStore

    let alert: AlertItem

    private var fixes: [AlertFix] {
        store.fixesByAlertID[alert.id] ?? []
    }

    var body: some View {
        CowtailCanvas {
            ScrollView {
                VStack(spacing: 20) {
                    heroCard

                    if !alert.actionTaken.isEmpty {
                        detailCard(title: "Recorded Action", body: alert.actionTaken)
                    }

                    if !alert.rootCause.isEmpty {
                        detailCard(title: "Root Cause", body: alert.rootCause)
                    }

                    metadataCard
                    linksCard
                    fixesCard
                }
                .padding(.horizontal)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("Alert")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await store.loadFixes(for: alert.id)
        }
    }

    private var heroCard: some View {
        CowtailHeroCard(gradient: palette.heroGradient) {
            AlertClassificationHeader(outcome: alert.outcome)

            Text(alert.alertName)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(.white)

            Text(alert.summary)
                .font(.body)
                .foregroundStyle(.white.opacity(0.84))

            HStack {
                Text(alert.timestamp.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.74))

                Spacer()

                if alert.status == .resolved {
                    Text("Resolved")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.84))
                }
            }
        }
    }

    private var metadataCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Metadata")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            metadataRow("Severity", value: alert.severity.label)
            metadataRow("Status", value: alert.status.label)
            metadataRow("Outcome", value: alert.outcome.label)

            if !alert.namespace.isEmpty {
                metadataRow("Namespace", value: alert.namespace)
            }

            if !alert.node.isEmpty {
                metadataRow("Node", value: alert.node)
            }

            if let resolvedAt = alert.resolvedAt {
                metadataRow("Resolved", value: resolvedAt.formatted(date: .abbreviated, time: .shortened))
            }

            metadataRow("Messaged", value: alert.messaged ? "Yes" : "No")
        }
        .cowtailCard()
    }

    private var linksCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Links")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            if let webURL = alert.webURL {
                Link(destination: webURL) {
                    HStack {
                        Label("Open Cowtail Web", systemImage: "globe")
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.footnote.weight(.semibold))
                    }
                    .font(.subheadline)
                }
            }
        }
        .cowtailCard()
    }

    private var fixesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Related Fixes")
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            if fixes.isEmpty {
                Text("No linked fixes recorded for this alert.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(fixes.enumerated()), id: \.element.id) { index, fix in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            ScopeBadge(scope: fix.scope)

                            Spacer()

                            Text(fix.timestamp, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text(fix.description)
                            .font(.subheadline.weight(.semibold))

                        if !fix.rootCause.isEmpty {
                            Text(fix.rootCause)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)

                    if index < fixes.count - 1 {
                        Divider()
                    }
                }
            }
        }
        .cowtailCard()
    }

    private func detailCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            Text(body)
                .font(.body)
        }
        .cowtailCard()
    }

    private func metadataRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }
}

private struct ScopeBadge: View {
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
        AlertDetailView(
            alert: AlertItem(
                id: "preview-alert",
                timestamp: .now,
                alertName: "CephHealthWarning",
                severity: .warning,
                namespace: "rook-ceph",
                node: "k8s-rhea",
                outcome: .fixed,
                summary: "Ceph HEALTH_WARN was caused by overdue deep scrubs.",
                rootCause: "A deep-scrub backlog missed the configured interval.",
                actionTaken: "Triggered manual deep-scrub to clear the backlog.",
                status: .firing,
                resolvedAt: nil,
                messaged: false
            )
        )
        .environmentObject(CowtailStore())
    }
}
