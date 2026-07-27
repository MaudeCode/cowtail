import SwiftUI

struct AlertInvestigationCard: View {
    let alert: AlertItem

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Investigation")

            HStack(spacing: 8) {
                Image(systemName: alert.workflowState.symbolName)
                    .foregroundStyle(alert.workflowState.tint)
                Text(alert.workflowState.label)
                    .font(.cowtailSans(15, weight: .semibold, relativeTo: .subheadline))
                Spacer()
                if let investigation = alert.investigation {
                    CowtailMonoLabel(
                        text: "Attempt \(investigation.attempts)/\(investigation.maxAttempts)"
                    )
                }
            }

            if let investigation = alert.investigation {
                if !investigation.lastError.isEmpty,
                   investigation.status == .failed || investigation.status == .deadletter {
                    VStack(alignment: .leading, spacing: 4) {
                        if !investigation.lastErrorPhase.isEmpty {
                            CowtailMonoLabel(text: investigation.lastErrorPhase.uppercased(), tint: .red)
                        }
                        Text(investigation.lastError)
                            .font(.cowtailSans(13, relativeTo: .footnote))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 4)
                }

                Text("Updated \(investigation.updatedAt.formatted(.relative(presentation: .named)))")
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(.secondary)
            } else {
                Text("No durable investigation job is attached to this alert.")
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.secondary)
            }

            if let disposition = alert.ownerDisposition {
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.fill")
                    Text(disposition == .noise ? "You classified this as noise" : "You kept this in Needs You")
                        .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                }
                if !alert.ownerNote.isEmpty {
                    Text(alert.ownerNote)
                        .font(.cowtailSans(13, relativeTo: .footnote))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("card.alert.investigation")
    }
}
