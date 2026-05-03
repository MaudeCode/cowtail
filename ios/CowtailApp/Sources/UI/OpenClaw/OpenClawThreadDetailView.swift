import SwiftUI

struct OpenClawThreadDetailView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    let threadID: String

    @State private var localErrorMessage: String?
    @State private var isShowingRename = false
    @State private var isShowingDeleteConfirmation = false
    @State private var composerIsFocused = false
    @State private var hasDeferredScrollToBottom = false

    private let bottomAnchorID = "openclaw-thread-bottom"

    private var thread: OpenClawThread? {
        store.threads.first { $0.id == threadID }
    }

    private var messages: [OpenClawMessageWithActions] {
        store.messagesByThreadID[threadID] ?? []
    }

    private var messageScrollSignature: [String] {
        messages.map { "\($0.id):\($0.updatedAt):\($0.deliveryState.rawValue):\($0.text.count):\($0.toolCalls.count)" }
    }

    private var style: OpenClawStyle {
        OpenClawStyle(palette: palette)
    }

    var body: some View {
        OpenClawScreen {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ZStack(alignment: .bottomTrailing) {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: style.transcriptSpacing) {
                                if shouldShowConnectionBanner {
                                    connectionBanner
                                }

                                if let errorMessage = localErrorMessage ?? store.errorMessage {
                                    errorCard(message: errorMessage)
                                }

                                if messages.isEmpty {
                                    emptyMessagesCard
                                } else {
                                    ForEach(messages) { message in
                                        OpenClawMessageBubble(message: message)
                                            .id(message.id)
                                            .accessibilityIdentifier("message.openclaw.\(message.id)")
                                    }
                                }

                                Color.clear
                                    .frame(height: 1)
                                    .id(bottomAnchorID)
                            }
                            .padding(.horizontal, style.transcriptHorizontalPadding)
                            .padding(.top, 14)
                            .padding(.bottom, 16)
                        }
                        .contentShape(Rectangle())
                        .simultaneousGesture(
                            TapGesture().onEnded {
                                composerIsFocused = false
                            }
                        )
                        .scrollDismissesKeyboard(.interactively)
                    }
                    .transaction { transaction in
                        if composerIsFocused {
                            transaction.animation = nil
                        }
                    }
                    .onAppear {
                        scrollToBottom(proxy: proxy, animated: false)
                    }
                    .onChange(of: messages.map(\.id)) { _, _ in
                        requestScrollToBottom(proxy: proxy, animated: true)
                    }
                    .onChange(of: messageScrollSignature) { _, _ in
                        requestScrollToBottom(proxy: proxy, animated: true)
                    }
                    .onChange(of: composerIsFocused) { _, isFocused in
                        guard !isFocused, hasDeferredScrollToBottom else { return }
                        hasDeferredScrollToBottom = false
                        scrollToBottom(proxy: proxy, animated: true)
                    }
                }

                OpenClawThreadComposer(
                    canSendReply: canSendReply,
                    isFocused: $composerIsFocused
                ) { text in
                    await sendReply(text: text)
                }
            }
        }
        .openClawStyle(OpenClawStyle(palette: palette))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.openclaw.thread-detail")
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                threadTitlePill
            }

            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        isShowingRename = true
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    .disabled(thread == nil)

                    Button(role: .destructive) {
                        isShowingDeleteConfirmation = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .disabled(thread == nil)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Thread actions")
                .accessibilityIdentifier("button.openclaw.thread-actions")
            }
        }
        .sheet(isPresented: $isShowingRename) {
            if let thread {
                OpenClawRenameThreadView(thread: thread)
                    .environmentObject(store)
            }
        }
        .confirmationDialog(
            "Delete Thread",
            isPresented: $isShowingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Thread", role: .destructive) {
                deleteThread()
            }
        } message: {
            Text("Delete this OpenClaw conversation.")
        }
        .task(id: threadID) {
            await store.loadMessages(threadId: threadID)
            do {
                try await store.markThreadRead(threadId: threadID)
            } catch {
                localErrorMessage = error.localizedDescription
            }
        }
    }

    private var threadTitlePill: some View {
        HStack(spacing: 8) {
            Text(thread?.title ?? "Thread")
                .font(.cowtailSans(15, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(style.primaryText)
                .lineLimit(1)

            Circle()
                .fill(store.connectionState.tint)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: 230)
        .background(style.floatingChromeSurface, in: Capsule())
        .overlay {
            Capsule()
                .stroke(style.border, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("title.openclaw.thread")
    }

    private var connectionBanner: some View {
        OpenClawInlineBanner(
            title: store.connectionState.displayTitle,
            message: connectionMessage,
            tint: store.connectionState.tint,
            systemImage: "wifi.exclamationmark",
            actionSystemImage: "arrow.clockwise",
            actionAccessibilityLabel: "Retry OpenClaw connection",
            actionAccessibilityIdentifier: "button.openclaw.reconnect"
        ) {
            Task {
                await store.reconnectForeground()
            }
        }
        .accessibilityIdentifier("card.openclaw.connection")
    }

    private var emptyMessagesCard: some View {
        OpenClawInlineBanner(
            title: "No Messages",
            message: "Messages for this thread have not loaded yet.",
            tint: .gray,
            systemImage: "bubble.left"
        )
    }

    private func errorCard(message: String) -> some View {
        OpenClawInlineBanner(
            title: "Thread Error",
            message: message,
            tint: .red,
            systemImage: "exclamationmark.triangle",
            messageLineLimit: nil
        )
    }

    private var canSendReply: Bool {
        store.connectionState == .connected
    }

    private var shouldShowConnectionBanner: Bool {
        store.connectionState != .connected
    }

    private var connectionMessage: String {
        switch store.connectionState {
        case .disconnected:
            return "OpenClaw is offline."
        case .signedOut:
            return "Sign in from Farmhouse to use OpenClaw."
        case .connecting:
            return "Connecting to OpenClaw."
        case .connected:
            return "Connected."
        case .reconnecting:
            return "Reconnecting to OpenClaw."
        case .failed(let message):
            return message
        }
    }

    @MainActor
    private func sendReply(text: String) async -> Bool {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, canSendReply else {
            return false
        }

        localErrorMessage = nil
        do {
            try await store.sendReply(threadId: threadID, text: text)
            return true
        } catch {
            localErrorMessage = error.localizedDescription
            return false
        }
    }

    private func requestScrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        guard !composerIsFocused else {
            hasDeferredScrollToBottom = true
            return
        }

        scrollToBottom(proxy: proxy, animated: animated)
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        let action = {
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }

        if animated {
            withAnimation(.easeOut(duration: 0.2), action)
        } else {
            action()
        }
    }

    private func deleteThread() {
        Task {
            do {
                try await store.deleteThread(threadId: threadID)
                universalLinkRouter.openClawPath.removeAll()
            } catch {
                localErrorMessage = error.localizedDescription
            }
        }
    }
}

private struct OpenClawThreadComposer: View {
    @Environment(\.openClawStyle) private var style

    let canSendReply: Bool
    @Binding var isFocused: Bool

    let sendReply: @MainActor (String) async -> Bool

    @State private var replyText = ""
    @State private var isSending = false
    @FocusState private var fieldIsFocused: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                ZStack(alignment: .leading) {
                    if replyText.isEmpty {
                        Text("Message")
                            .font(.cowtailSans(15, relativeTo: .body))
                            .foregroundStyle(style.secondaryText.opacity(0.72))
                            .allowsHitTesting(false)
                    }

                    TextField("", text: $replyText, axis: .vertical)
                        .focused($fieldIsFocused)
                        .font(.cowtailSans(15, relativeTo: .body))
                        .textInputAutocapitalization(.sentences)
                        .lineLimit(1...7)
                        .accessibilityLabel("Message")
                        .accessibilityIdentifier("field.openclaw.reply")
                }
                .frame(minHeight: style.sendTapTargetSize, alignment: .center)

                Button {
                    sendCurrentReply()
                } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: style.controlCornerRadius, style: .continuous)
                            .fill(canSendCurrentReply ? style.accent : style.border)
                            .frame(width: style.sendButtonSize, height: style.sendButtonSize)

                        if isSending {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.headline.weight(.bold))
                        }
                    }
                    .frame(width: style.sendTapTargetSize, height: style.sendTapTargetSize)
                    .contentShape(Rectangle())
                }
                .foregroundStyle(canSendCurrentReply ? .white : style.secondaryText)
                .disabled(!canSendCurrentReply)
                .accessibilityLabel("Send reply")
                .accessibilityIdentifier("button.openclaw.send-reply")
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(style.composerSurface, in: RoundedRectangle(cornerRadius: style.composerCornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: style.composerCornerRadius, style: .continuous)
                    .stroke(fieldIsFocused ? style.accent.opacity(0.55) : style.border, lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.24), radius: 18, x: 0, y: 10)
        }
        .padding(.horizontal, style.transcriptHorizontalPadding)
        .padding(.top, 6)
        .padding(.bottom, 12)
        .onChange(of: fieldIsFocused) { _, newValue in
            isFocused = newValue
        }
        .onChange(of: isFocused) { _, newValue in
            guard fieldIsFocused != newValue else { return }
            fieldIsFocused = newValue
        }
    }

    private var trimmedReply: String {
        replyText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSendCurrentReply: Bool {
        canSendReply && !isSending && !trimmedReply.isEmpty
    }

    private func sendCurrentReply() {
        let text = trimmedReply
        guard canSendCurrentReply else { return }

        isSending = true
        Task { @MainActor in
            let didSend = await sendReply(text)
            if didSend {
                replyText = ""
            }
            isSending = false
        }
    }
}

#Preview {
    NavigationStack {
        OpenClawThreadDetailView(threadID: CowtailPreviewFixtures.openClawThread.id)
            .environmentObject(CowtailPreviewFixtures.openClawStore())
            .environmentObject(UniversalLinkRouter.shared)
    }
}
