import SwiftUI

struct OpenClawMessageBubble: View {
    @Environment(\.cowtailPalette) private var palette

    let message: OpenClawMessageWithActions

    private var isUserMessage: Bool {
        message.direction == .userToOpenClaw
    }

    var body: some View {
        HStack(alignment: .bottom) {
            if isUserMessage {
                Spacer(minLength: 36)
            }

            VStack(alignment: .leading, spacing: 10) {
                if let authorLabel = message.authorLabel, !authorLabel.isEmpty {
                    Text(authorLabel)
                        .font(.cowtailMono(10, weight: .medium, relativeTo: .caption2))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                }

                Text(message.text)
                    .font(.cowtailSans(15, relativeTo: .body))
                    .foregroundStyle(isUserMessage ? .white : palette.ink)
                    .textSelection(.enabled)

                if !message.links.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(message.links) { link in
                            if let url = URL(string: link.url) {
                                Link(destination: url) {
                                    Label(link.label, systemImage: "arrow.up.right")
                                        .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                                }
                            } else {
                                Text(link.label)
                                    .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                            }
                        }
                    }
                }

                OpenClawActionButtons(actions: message.actions)

                if message.deliveryState != .sent {
                    Text(message.deliveryState.displayTitle)
                        .font(.cowtailMono(10, weight: .medium, relativeTo: .caption2))
                        .foregroundStyle(isUserMessage ? .white.opacity(0.75) : .secondary)
                        .textCase(.uppercase)
                }
            }
            .padding(14)
            .background(
                isUserMessage ? palette.accent : palette.surface,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isUserMessage ? Color.clear : palette.border, lineWidth: 1)
            )
            .frame(maxWidth: 520, alignment: isUserMessage ? .trailing : .leading)

            if !isUserMessage {
                Spacer(minLength: 36)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUserMessage ? .trailing : .leading)
    }
}

private extension OpenClawDeliveryState {
    var displayTitle: String {
        switch self {
        case .pending:
            return "Pending"
        case .sent:
            return "Sent"
        case .failed:
            return "Failed"
        }
    }
}

#Preview {
    OpenClawMessageBubble(message: CowtailPreviewFixtures.openClawMessageWithActions)
        .environmentObject(CowtailPreviewFixtures.openClawStore())
        .padding()
        .background(Color.black)
}
