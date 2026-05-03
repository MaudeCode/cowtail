import SwiftUI

struct OpenClawScreen<Content: View>: View {
    @Environment(\.openClawStyle) private var style
    @ViewBuilder let content: () -> Content

    var body: some View {
        CowtailCanvas {
            content()
        }
        .font(.cowtailSans(15, relativeTo: .body))
        .foregroundStyle(style.primaryText)
    }
}

struct OpenClawInlineBanner: View {
    @Environment(\.openClawStyle) private var style
    let title: String
    let message: String
    let tint: Color
    let systemImage: String
    let actionSystemImage: String
    let actionAccessibilityLabel: String
    let actionAccessibilityIdentifier: String?
    let messageLineLimit: Int?
    var action: (() -> Void)?

    init(
        title: String,
        message: String,
        tint: Color,
        systemImage: String,
        actionSystemImage: String = "arrow.right",
        actionAccessibilityLabel: String = "OpenClaw banner action",
        actionAccessibilityIdentifier: String? = nil,
        messageLineLimit: Int? = 3,
        action: (() -> Void)? = nil
    ) {
        self.title = title
        self.message = message
        self.tint = tint
        self.systemImage = systemImage
        self.actionSystemImage = actionSystemImage
        self.actionAccessibilityLabel = actionAccessibilityLabel
        self.actionAccessibilityIdentifier = actionAccessibilityIdentifier
        self.messageLineLimit = messageLineLimit
        self.action = action
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                Text(message)
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(style.secondaryText)
                    .lineLimit(messageLineLimit)
            }
            Spacer(minLength: 0)
            if let action {
                Button(action: action) {
                    Image(systemName: actionSystemImage)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel(actionAccessibilityLabel)
                .openClawAccessibilityIdentifier(actionAccessibilityIdentifier)
            }
        }
        .padding(12)
        .background(style.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(style.border, lineWidth: 1)
        }
    }
}

struct OpenClawTranscriptDivider: View {
    @Environment(\.openClawStyle) private var style

    var body: some View {
        Rectangle()
            .fill(style.border)
            .frame(height: 1)
            .opacity(0.75)
    }
}

private struct OpenClawFieldChrome: ViewModifier {
    @Environment(\.openClawStyle) private var style
    let isFocused: Bool

    func body(content: Content) -> some View {
        content
            .font(.cowtailSans(15, relativeTo: .body))
            .padding(12)
            .background(style.surface, in: RoundedRectangle(cornerRadius: style.controlCornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: style.controlCornerRadius, style: .continuous)
                    .stroke(isFocused ? style.accent.opacity(0.55) : style.border, lineWidth: 1)
            }
    }
}

extension View {
    func openClawFieldChrome(isFocused: Bool = false) -> some View {
        modifier(OpenClawFieldChrome(isFocused: isFocused))
    }
}

private extension View {
    @ViewBuilder
    func openClawAccessibilityIdentifier(_ identifier: String?) -> some View {
        if let identifier {
            accessibilityIdentifier(identifier)
        } else {
            self
        }
    }
}
