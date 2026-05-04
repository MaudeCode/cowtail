import SwiftUI

struct OpenClawMessageBubble: View {
    @Environment(\.openClawStyle) private var style

    let message: OpenClawMessageWithActions

    private var isUserMessage: Bool {
        message.direction == .userToOpenClaw
    }

    private var isStreaming: Bool {
        message.direction == .openClawToUser && message.deliveryState == .pending
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            messageContent
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 0)
        .accessibilityElement(children: .contain)
    }

    private var assistantBlocks: [IdentifiedOpenClawMessageRenderBlock] {
        OpenClawMessageRenderPlan.identifiedBlocks(for: message)
    }

    @ViewBuilder
    private var messageContent: some View {
        if isUserMessage {
            HStack(alignment: .top, spacing: 10) {
                Spacer(minLength: 42)

                VStack(alignment: .trailing, spacing: 8) {
                    Text("You")
                        .font(.cowtailSans(12, weight: .semibold, relativeTo: .caption))
                        .foregroundStyle(style.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(style.accentSoft, in: Capsule())
                        .overlay {
                            Capsule()
                                .stroke(style.accent.opacity(0.20), lineWidth: 1)
                        }

                    transcriptText(message.text)
                    links
                    OpenClawActionButtons(actions: message.actions)
                }
                .padding(.trailing, 10)
                .frame(maxWidth: 360, alignment: .trailing)
                .overlay(alignment: .trailing) {
                    Capsule()
                        .fill(style.accent.opacity(0.52))
                        .frame(width: 2)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                if let statusTitle = message.deliveryState != .sent && !isStreaming ? message.deliveryState.displayTitle : nil {
                    Text(statusTitle)
                        .font(.cowtailSans(12, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(style.secondaryText)
                }

                ForEach(assistantBlocks) { block in
                    switch block.content {
                    case .text(let text):
                        transcriptText(text)
                    case .tool(let toolCall):
                        OpenClawToolCallCard(toolCall: toolCall)
                    }
                }

                if isStreaming {
                    streamingIndicator
                }

                links
                OpenClawActionButtons(actions: message.actions)
            }
        }
    }

    @ViewBuilder
    private func transcriptText(_ text: String) -> some View {
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(attributedText(text))
                .font(.cowtailSans(isUserMessage ? 17 : 18, relativeTo: .body))
                .foregroundStyle(style.primaryText)
                .lineSpacing(isUserMessage ? 4 : 5)
                .multilineTextAlignment(isUserMessage ? .trailing : .leading)
                .textSelection(.enabled)
        }
    }

    private func attributedText(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    private var links: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(message.links) { link in
                if let url = URL(string: link.url) {
                    Link(destination: url) {
                        Label(link.label, systemImage: "arrow.up.right")
                            .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                            .foregroundStyle(style.accent)
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(style.transcriptHoverSurface, in: RoundedRectangle(cornerRadius: style.toolNameCornerRadius, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: style.toolNameCornerRadius, style: .continuous)
                                    .stroke(style.border, lineWidth: 1)
                            }
                    }
                } else {
                    Text(link.label)
                        .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                        .foregroundStyle(style.secondaryText)
                }
            }
        }
    }

    private var streamingIndicator: some View {
        HStack(spacing: 6) {
            if message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Thinking")
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(style.secondaryText)
            }
            StreamingPulse()
            StreamingPulse(delay: 0.16)
            StreamingPulse(delay: 0.32)
        }
        .padding(.top, message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 2)
        .accessibilityLabel("OpenClaw is responding")
        .accessibilityIdentifier("indicator.openclaw.responding.\(message.id)")
    }
}

enum OpenClawMessageRenderBlock: Equatable {
    case text(String)
    case tool(OpenClawToolCall)
}

struct IdentifiedOpenClawMessageRenderBlock: Equatable, Identifiable {
    let id: String
    let content: OpenClawMessageRenderBlock
}

extension OpenClawMessageRenderBlock {
    var renderIdentityComponent: String {
        switch self {
        case .text(let text):
            return "text:\(text.utf16.count)"
        case .tool(let toolCall):
            return "tool:\(toolCall.id)"
        }
    }
}

enum OpenClawMessageRenderPlan {
    static func identifiedBlocks(for message: OpenClawMessageWithActions) -> [IdentifiedOpenClawMessageRenderBlock] {
        blocks(for: message).enumerated().map { index, block in
            IdentifiedOpenClawMessageRenderBlock(
                id: "\(index):\(block.renderIdentityComponent)",
                content: block
            )
        }
    }

    static func blocks(for message: OpenClawMessageWithActions) -> [OpenClawMessageRenderBlock] {
        guard message.direction == .openClawToUser else {
            return fallbackBlocks(text: message.text, toolCalls: message.toolCalls)
        }

        guard let placements = orderedPlacements(for: message.toolCalls, in: message.text) else {
            return fallbackBlocks(text: message.text, toolCalls: message.toolCalls)
        }

        var blocks: [OpenClawMessageRenderBlock] = []
        var textCursor = 0
        for placement in placements {
            appendText(from: textCursor, to: placement.utf16Offset, in: message.text, to: &blocks)
            blocks.append(.tool(placement.toolCall))
            textCursor = placement.utf16Offset
        }
        appendText(from: textCursor, to: message.text.utf16.count, in: message.text, to: &blocks)
        return blocks
    }

    private static func orderedPlacements(
        for toolCalls: [OpenClawToolCall],
        in text: String
    ) -> [ToolPlacement]? {
        var placements: [ToolPlacement] = []
        placements.reserveCapacity(toolCalls.count)

        for (index, toolCall) in toolCalls.enumerated() {
            guard let utf16Offset = toolCall.insertedAtContentLength,
                  let snapshot = toolCall.contentSnapshotAtStart,
                  utf16Offset >= 0,
                  utf16Offset <= text.utf16.count,
                  snapshot.utf16.count == utf16Offset,
                  text.hasPrefix(snapshot),
                  text.utf16Index(offsetBy: utf16Offset) != nil else {
                return nil
            }

            placements.append(ToolPlacement(toolCall: toolCall, utf16Offset: utf16Offset, sourceIndex: index))
        }

        return placements.sorted {
            if $0.utf16Offset == $1.utf16Offset {
                return $0.sourceIndex < $1.sourceIndex
            }
            return $0.utf16Offset < $1.utf16Offset
        }
    }

    private static func fallbackBlocks(
        text: String,
        toolCalls: [OpenClawToolCall]
    ) -> [OpenClawMessageRenderBlock] {
        var blocks: [OpenClawMessageRenderBlock] = []
        appendWholeText(text, to: &blocks)
        blocks.append(contentsOf: toolCalls.map(OpenClawMessageRenderBlock.tool))
        return blocks
    }

    private static func appendText(
        from startOffset: Int,
        to endOffset: Int,
        in text: String,
        to blocks: inout [OpenClawMessageRenderBlock]
    ) {
        guard startOffset < endOffset,
              let startIndex = text.utf16Index(offsetBy: startOffset),
              let endIndex = text.utf16Index(offsetBy: endOffset) else {
            return
        }

        appendWholeText(String(text[startIndex..<endIndex]), to: &blocks)
    }

    private static func appendWholeText(
        _ text: String,
        to blocks: inout [OpenClawMessageRenderBlock]
    ) {
        guard !text.isEmpty else { return }
        blocks.append(.text(text))
    }

    private struct ToolPlacement {
        let toolCall: OpenClawToolCall
        let utf16Offset: Int
        let sourceIndex: Int
    }
}

private extension String {
    func utf16Index(offsetBy offset: Int) -> String.Index? {
        guard let utf16Index = utf16.index(utf16.startIndex, offsetBy: offset, limitedBy: utf16.endIndex) else {
            return nil
        }
        return String.Index(utf16Index, within: self)
    }
}

private struct StreamingPulse: View {
    @Environment(\.openClawStyle) private var style
    let delay: Double
    @State private var isOn = false

    init(delay: Double = 0) {
        self.delay = delay
    }

    var body: some View {
        Circle()
            .fill(style.accent)
            .frame(width: 6, height: 6)
            .opacity(isOn ? 1 : 0.32)
            .animation(.easeInOut(duration: 0.7).delay(delay).repeatForever(autoreverses: true), value: isOn)
            .onAppear {
                isOn = true
            }
    }
}

private struct OpenClawToolCallCard: View {
    @Environment(\.openClawStyle) private var style
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
                        .foregroundStyle(style.primaryText)
                        .lineLimit(1)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: style.toolNameCornerRadius, style: .continuous)
                                .fill(style.transcriptHoverSurface)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: style.toolNameCornerRadius, style: .continuous)
                                .stroke(style.border, lineWidth: 1)
                        }

                    Text(summary)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(style.secondaryText)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    if let durationTitle {
                        Text(durationTitle)
                            .font(.cowtailMono(11, relativeTo: .caption2))
                            .foregroundStyle(style.secondaryText)
                            .lineLimit(1)
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(style.secondaryText)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .contentShape(Rectangle())
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
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
                .padding(10)
                .background(style.transcriptSecondarySurface)
                .overlay(alignment: .top) {
                    OpenClawTranscriptDivider()
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: style.toolCornerRadius, style: .continuous)
                .fill(style.codeBlockSurface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: style.toolCornerRadius, style: .continuous)
                .stroke(toolCall.status.borderColor(in: style), lineWidth: 1)
        )
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

    private var durationTitle: String? {
        guard let startedAt = toolCall.startedAt,
              let completedAt = toolCall.completedAt,
              completedAt >= startedAt else {
            return nil
        }

        let duration = completedAt - startedAt
        if duration < 1_000 {
            return "\(duration) ms"
        }

        let seconds = Double(duration) / 1_000
        return seconds.formatted(.number.precision(.fractionLength(1))) + " s"
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
                .foregroundStyle(style.secondaryText)
                .frame(width: 16, height: 16)
        case .complete:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(style.success)
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
                .foregroundStyle(style.secondaryText)

            Text(value)
                .font(.cowtailMono(11, relativeTo: .caption2))
                .foregroundStyle(style.primaryText)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(style.transcriptHoverSurface)
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

    func borderColor(in style: OpenClawStyle) -> Color {
        switch self {
        case .pending:
            return style.border
        case .running:
            return style.accent.opacity(0.45)
        case .complete:
            return style.border
        case .error:
            return Color.red.opacity(0.45)
        }
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
