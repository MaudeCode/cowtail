import SwiftUI

struct AlertMetadataCard: View {
    let alert: AlertItem

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Metadata")

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
    }

    private func metadataRow(_ title: String, value: String) -> some View {
        HStack {
            CowtailMonoLabel(text: title)
            Spacer()
            Text(value)
                .font(.cowtailSans(15, relativeTo: .subheadline))
                .multilineTextAlignment(.trailing)
        }
    }
}
