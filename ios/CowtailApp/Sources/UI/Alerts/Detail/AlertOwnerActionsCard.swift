import SwiftUI

struct AlertOwnerActionsCard: View {
    @EnvironmentObject private var store: CowtailStore
    @State private var note = ""
    @State private var pendingAction: AlertHumanAction?

    let alert: AlertItem

    private var isWorking: Bool {
        store.isPerformingAction(for: alert.id)
    }

    private var confirmationIsPresented: Binding<Bool> {
        Binding(
            get: { pendingAction != nil },
            set: {
                if !$0 {
                    pendingAction = nil
                }
            }
        )
    }

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Your Actions")

            Text("Classify the alert or send its durable investigation back through the worker queue.")
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.secondary)

            TextField("Optional note", text: $note, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1 ... 3)
                .onChange(of: note) { _, value in
                    if value.count > AlertHumanAction.noteCharacterLimit {
                        note = String(value.prefix(AlertHumanAction.noteCharacterLimit))
                    }
                }
                .accessibilityIdentifier("field.alert.action-note")

            Text("\(note.count)/\(AlertHumanAction.noteCharacterLimit)")
                .font(.cowtailMono(11, relativeTo: .caption))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)

            if alert.investigation?.canRetry == true {
                Button {
                    Task { await perform(.retryInvestigation) }
                } label: {
                    Label("Run Investigation Again", systemImage: "arrow.clockwise")
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isWorking)
                .accessibilityIdentifier("button.alert.retry-investigation")
            }

            HStack(spacing: 10) {
                Button {
                    pendingAction = .markNoise
                } label: {
                    Label("Mark Noise", systemImage: "speaker.slash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isWorking || alert.ownerDisposition == .noise)
                .accessibilityIdentifier("button.alert.mark-noise")

                Button {
                    pendingAction = .escalate
                } label: {
                    Label("Keep in Needs You", systemImage: "person.crop.circle.badge.exclamationmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isWorking || alert.ownerDisposition == .escalated)
                .accessibilityIdentifier("button.alert.escalate")
            }
            .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))

            if isWorking {
                ProgressView("Updating alert...")
                    .font(.cowtailSans(13, relativeTo: .footnote))
            }

            if let error = store.actionError(for: alert.id) {
                Text(error)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("text.alert.action-error")
            }
        }
        .confirmationDialog(
            confirmationTitle,
            isPresented: confirmationIsPresented,
            titleVisibility: .visible
        ) {
            if let pendingAction {
                Button(confirmationButtonTitle, role: pendingAction == .markNoise ? .destructive : nil) {
                    Task { await perform(pendingAction) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(confirmationMessage)
        }
    }

    private var confirmationTitle: String {
        pendingAction == .markNoise ? "Mark this alert as noise?" : "Keep this alert in Needs You?"
    }

    private var confirmationButtonTitle: String {
        pendingAction == .markNoise ? "Mark as Noise" : "Keep in Needs You"
    }

    private var confirmationMessage: String {
        switch pendingAction {
        case .markNoise:
            "This records your decision and stops queued retries. You can run the investigation again later."
        case .escalate:
            "This records an owner decision so a late worker result cannot clear the alert from Needs You."
        case .retryInvestigation, .none:
            ""
        }
    }

    private func perform(_ action: AlertHumanAction) async {
        pendingAction = nil
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let succeeded = await store.performAlertAction(
            alertID: alert.id,
            action: action,
            note: trimmedNote.isEmpty ? nil : trimmedNote
        )
        if succeeded {
            note = ""
        }
    }
}
