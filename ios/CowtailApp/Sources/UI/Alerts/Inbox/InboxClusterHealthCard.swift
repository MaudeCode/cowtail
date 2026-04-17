import SwiftUI

struct InboxClusterHealthCard: View {
    @Environment(\.cowtailPalette) private var palette

    let health: HealthSummary?
    let healthErrorMessage: String?
    let isLoading: Bool

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Cluster Health")

            if let health {
                content(for: health)
            } else if isLoading {
                ProgressView("Loading cluster health...")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Cluster health unavailable")
                        .font(.cowtailSans(15, weight: .semibold, relativeTo: .subheadline))

                    Text(healthErrorMessage ?? "Health data is unavailable right now.")
                        .font(.cowtailSans(13, relativeTo: .footnote))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func content(for health: HealthSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(health.cephStatus)
                        .font(.cowtailSans(18, weight: .bold, relativeTo: .title3))

                    Text(health.cephMessage)
                        .font(.cowtailSans(13, relativeTo: .footnote))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Text("\(health.readyNodeCount)/\(health.nodes.count)")
                    .font(.cowtailSans(16, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(palette.success)
            }

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    CowtailMonoLabel(text: "Storage")
                    Spacer()
                    Text(
                        "\(health.storageUsed.formatted(.number.precision(.fractionLength(1)))) / \(health.storageTotal.formatted(.number.precision(.fractionLength(1)))) \(health.storageUnit)"
                    )
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.secondary)
                }

                ProgressView(value: health.storageUsed, total: max(health.storageTotal, 1))
                    .tint(palette.accent)
                    .scaleEffect(x: 1, y: 0.9, anchor: .center)
            }

            if !health.nodes.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    CowtailMonoLabel(text: "Nodes")

                    ForEach(health.nodes) { node in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Circle()
                                .fill(node.isReady ? palette.success : palette.warning)
                                .frame(width: 6, height: 6)

                            Text(node.name)
                                .font(.cowtailSans(13, weight: .medium, relativeTo: .footnote))
                                .lineLimit(1)

                            Spacer()

                            CowtailMonoLabel(text: "\(node.cpu)% CPU  \(node.memory)% MEM")
                        }
                    }
                }
            }

            if let healthErrorMessage, !healthErrorMessage.isEmpty {
                Divider()
                Text(healthErrorMessage)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    InboxClusterHealthCard(
        health: CowtailPreviewFixtures.health,
        healthErrorMessage: nil,
        isLoading: false
    )
    .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
