import SwiftUI

struct OpenClawActionButtons: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore

    let actions: [OpenClawAction]

    @State private var submittingActionIDs: Set<String> = []

    private var visibleActions: [OpenClawAction] {
        actions.filter { $0.state == .pending }
    }

    var body: some View {
        if !visibleActions.isEmpty {
            FlowLayout(spacing: 8) {
                ForEach(visibleActions) { action in
                    Button {
                        submit(action)
                    } label: {
                        HStack(spacing: 6) {
                            if submittingActionIDs.contains(action.id) {
                                ProgressView()
                                    .controlSize(.mini)
                            }
                            Text(action.label)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(palette.accent)
                    .disabled(submittingActionIDs.contains(action.id))
                    .accessibilityIdentifier("button.openclaw.action.\(action.id)")
                }
            }
        }
    }

    private func submit(_ action: OpenClawAction) {
        submittingActionIDs.insert(action.id)
        Task {
            defer {
                submittingActionIDs.remove(action.id)
            }

            do {
                try await store.submitAction(actionId: action.id, payload: action.payload)
            } catch {
                store.errorMessage = error.localizedDescription
            }
        }
    }
}

private struct FlowLayout<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: () -> Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: spacing) {
                content()
            }

            VStack(alignment: .leading, spacing: spacing) {
                content()
            }
        }
    }
}

#Preview {
    OpenClawActionButtons(actions: [CowtailPreviewFixtures.openClawAction])
        .environmentObject(CowtailPreviewFixtures.openClawStore())
        .padding()
}
