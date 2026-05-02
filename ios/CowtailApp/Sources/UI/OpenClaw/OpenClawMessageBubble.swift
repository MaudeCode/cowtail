import SwiftUI

struct OpenClawMessageBubble: View {
    @Environment(\.cowtailPalette) private var palette

    let message: OpenClawMessageWithActions

    private var isUserMessage: Bool {
        message.direction == .userToOpenClaw
    }

    private var isStreaming: Bool {
        message.direction == .openClawToUser && message.deliveryState == .pending
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            speakerMark

            VStack(alignment: .leading, spacing: 12) {
                header

                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private var messageBody: AttributedString {
        (try? AttributedString(markdown: message.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(message.text)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(messageBody)
                    .font(.cowtailSans(isUserMessage ? 15 : 16, relativeTo: .body))
                    .foregroundStyle(palette.ink)
                    .lineSpacing(isUserMessage ? 2 : 4)
                    .textSelection(.enabled)
            }

            toolCalls

            if isStreaming {
                streamingIndicator
            }

            links
            OpenClawActionButtons(actions: message.actions)
        }
        .padding(.vertical, isUserMessage ? 12 : 0)
        .padding(.horizontal, isUserMessage ? 14 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground)
    }

    private var speakerMark: some View {
        ZStack {
            Circle()
                .fill(isUserMessage ? palette.surface : palette.accent.opacity(0.14))
                .overlay(
                    Circle()
                        .stroke(isUserMessage ? palette.border : palette.accent.opacity(0.35), lineWidth: 1)
                )

            Image(systemName: isUserMessage ? "person.fill" : "sparkles")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isUserMessage ? .secondary : palette.accent)
        }
        .frame(width: 30, height: 30)
        .accessibilityHidden(true)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(speakerTitle)
                .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                .foregroundStyle(palette.ink)

            Text(message.createdAt.openClawTimestampTitle)
                .font(.cowtailSans(12, relativeTo: .caption))
                .foregroundStyle(.secondary)

            if message.deliveryState != .sent && !isStreaming {
                Text(message.deliveryState.displayTitle)
                    .font(.cowtailSans(12, weight: .medium, relativeTo: .caption))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var toolCalls: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(message.toolCalls) { toolCall in
                OpenClawToolCallCard(toolCall: toolCall)
                    .accessibilityIdentifier("tool.openclaw.\(toolCall.id)")
            }
        }
    }

    private var links: some View {
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

    @ViewBuilder
    private var rowBackground: some View {
        if isUserMessage {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(palette.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(palette.border, lineWidth: 1)
                )
        }
    }

    private var streamingIndicator: some View {
        HStack(spacing: 6) {
            StreamingPulse()
            StreamingPulse(delay: 0.16)
            StreamingPulse(delay: 0.32)
        }
        .padding(.top, 2)
        .accessibilityLabel("OpenClaw is responding")
    }

    private var speakerTitle: String {
        if isUserMessage {
            return "You"
        }

        let trimmed = message.authorLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "OpenClaw" : trimmed
    }
}

private struct StreamingPulse: View {
    @Environment(\.cowtailPalette) private var palette
    let delay: Double
    @State private var isOn = false

    init(delay: Double = 0) {
        self.delay = delay
    }

    var body: some View {
        Circle()
            .fill(palette.accent)
            .frame(width: 6, height: 6)
            .opacity(isOn ? 1 : 0.32)
            .animation(.easeInOut(duration: 0.7).delay(delay).repeatForever(autoreverses: true), value: isOn)
            .onAppear {
                isOn = true
            }
    }
}

private struct OpenClawToolCallCard: View {
    @Environment(\.cowtailPalette) private var palette
    let toolCall: OpenClawToolCall
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    statusIcon

                    Text(toolCall.name)
                        .font(.cowtailMono(12, weight: .semibold, relativeTo: .caption))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)

                    Text(summary)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .contentShape(Rectangle())
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Tool call \(toolCall.name)")
            .accessibilityValue("\(toolCall.status.displayTitle), \(isExpanded ? "expanded" : "collapsed")")
            .accessibilityHint("Shows tool input and output")
            .accessibilityIdentifier("tool.openclaw.\(toolCall.id)")

            if isExpanded {
                VStack(alignment: .leading, spacing: 10) {
                    if let args = toolCall.args, !args.isEmpty {
                        toolDetail(
                            title: "Input",
                            value: JSONValue.object(args).prettyPrinted,
                            identifier: "tool.openclaw.\(toolCall.id).input"
                        )
                    }
                    if let result = toolCall.result {
                        toolDetail(
                            title: "Output",
                            value: result.prettyPrinted,
                            identifier: "tool.openclaw.\(toolCall.id).output"
                        )
                    }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 10)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(toolCall.status.borderColor(in: palette), lineWidth: 1)
        )
        .accessibilityIdentifier("tool.openclaw.\(toolCall.id)")
    }

    private var summary: String {
        if let args = toolCall.args {
            for key in ["query", "command", "path", "url", "action"] {
                if case .string(let value)? = args[key], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return value
                }
            }
        }
        if let result = toolCall.result?.singleLineSummary {
            return result
        }
        return toolCall.status.displayTitle
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch toolCall.status {
        case .running:
            ProgressView()
                .controlSize(.mini)
                .frame(width: 16, height: 16)
        case .pending:
            Image(systemName: "circle")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 16, height: 16)
        case .complete:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.green)
                .frame(width: 16, height: 16)
        case .error:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.red)
                .frame(width: 16, height: 16)
        }
    }

    private func toolDetail(title: String, value: String, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.cowtailSans(11, weight: .semibold, relativeTo: .caption2))
                .foregroundStyle(.secondary)

            Text(value)
                .font(.cowtailMono(11, relativeTo: .caption2))
                .foregroundStyle(palette.ink)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(palette.ink.opacity(0.04))
                )
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
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

private extension OpenClawToolCallStatus {
    var displayTitle: String {
        switch self {
        case .pending:
            return "Pending"
        case .running:
            return "Running"
        case .complete:
            return "Complete"
        case .error:
            return "Error"
        }
    }

    func borderColor(in palette: ThemePalette) -> Color {
        switch self {
        case .pending:
            return palette.border
        case .running:
            return palette.accent.opacity(0.45)
        case .complete:
            return palette.border
        case .error:
            return Color.red.opacity(0.45)
        }
    }
}

private extension Int64 {
    var openClawTimestampTitle: String {
        let date = Date(timeIntervalSince1970: TimeInterval(self) / 1000)
        return date.formatted(date: .omitted, time: .shortened)
    }
}

private extension JSONValue {
    var singleLineSummary: String? {
        switch self {
        case .string(let value):
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return trimmed.split(separator: "\n", maxSplits: 1).first.map(String.init)
        case .number(let value):
            return String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .null:
            return "null"
        case .object, .array:
            return nil
        }
    }

    var prettyPrinted: String {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            return String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .null:
            return "null"
        case .object(let object):
            return prettyPrintJSONObject(object)
        case .array(let array):
            return prettyPrintJSONArray(array)
        }
    }

    private func prettyPrintJSONObject(_ value: [String: JSONValue]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(value),
              let string = String(data: data, encoding: .utf8) else {
            return String(describing: value)
        }
        return string
    }

    private func prettyPrintJSONArray(_ value: [JSONValue]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(value),
              let string = String(data: data, encoding: .utf8) else {
            return String(describing: value)
        }
        return string
    }
}

#Preview {
    OpenClawMessageBubble(message: CowtailPreviewFixtures.openClawMessageWithActions)
        .environmentObject(CowtailPreviewFixtures.openClawStore())
        .padding()
        .background(Color.black)
}
