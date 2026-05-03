import SwiftUI

struct OpenClawActionButtons: View {
    @Environment(\.openClawStyle) private var style
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
                                .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                                .foregroundStyle(style.accent)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(minHeight: 44)
                        .background(style.accentSoft, in: RoundedRectangle(cornerRadius: style.controlCornerRadius, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: style.controlCornerRadius, style: .continuous)
                                .stroke(style.accent.opacity(0.28), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(style.accent)
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
