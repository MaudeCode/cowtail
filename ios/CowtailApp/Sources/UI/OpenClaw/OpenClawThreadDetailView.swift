import SwiftUI

struct OpenClawThreadDetailView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    let threadID: String

    @State private var localErrorMessage: String?
    @State private var isShowingRename = false
    @State private var isShowingDeleteConfirmation = false

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

    var body: some View {
        CowtailCanvas {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 22) {
                            detailHeader

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
                        .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                        .padding(.top, CowtailDesignGuide.pageTopPadding)
                        .padding(.bottom, 12)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onAppear {
                        scrollToBottom(proxy: proxy, animated: false)
                    }
                    .onChange(of: messages.map(\.id)) { _, _ in
                        scrollToBottom(proxy: proxy, animated: true)
                    }
                    .onChange(of: messageScrollSignature) { _, _ in
                        scrollToBottom(proxy: proxy, animated: true)
                    }
                }

                OpenClawThreadComposer(canSendReply: canSendReply) { text in
                    await sendReply(text: text)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.openclaw.thread-detail")
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
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

    private var detailHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                Circle()
                    .fill(palette.accent.opacity(0.14))
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(palette.accent)
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 4) {
                CowtailMonoLabel(text: "OpenClaw")
                Text(thread?.title ?? "Thread")
                    .font(.cowtailSans(22, weight: .bold, relativeTo: .title3))
                    .foregroundStyle(palette.ink)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            if let thread {
                CowtailStatusBadge(title: thread.status.displayTitle, tint: thread.status.tint)
            }
        }
        .padding(.top, 2)
    }

    private var connectionBanner: some View {
        CowtailCard {
            HStack(spacing: 12) {
                CowtailStatusBadge(title: store.connectionState.displayTitle, tint: store.connectionState.tint)

                Text(connectionMessage)
                    .font(.cowtailSans(13, relativeTo: .footnote))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                Spacer(minLength: 0)

                Button {
                    Task {
                        await store.reconnectForeground()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Reconnect OpenClaw")
                .accessibilityIdentifier("button.openclaw.reconnect")
            }
        }
        .accessibilityIdentifier("card.openclaw.connection")
    }

    private var emptyMessagesCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "No Messages")
            Text("Messages for this thread have not loaded yet.")
                .font(.cowtailSans(15, relativeTo: .subheadline))
                .foregroundStyle(.secondary)
        }
    }

    private func errorCard(message: String) -> some View {
        CowtailCard {
            CowtailSectionHeader(title: "Thread Error")
            Text(message)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.red)
        }
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
    @Environment(\.cowtailPalette) private var palette

    let canSendReply: Bool
    let sendReply: @MainActor (String) async -> Bool

    @State private var replyText = ""
    @State private var isSending = false
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 8) {
            Divider()

            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message OpenClaw", text: $replyText, axis: .vertical)
                    .focused($isFocused)
                    .font(.cowtailSans(15, relativeTo: .body))
                    .textInputAutocapitalization(.sentences)
                    .autocorrectionDisabled()
                    .textContentType(.none)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(isFocused ? palette.accent.opacity(0.7) : palette.border, lineWidth: 1)
                    )
                    .lineLimit(1...5)
                    .accessibilityIdentifier("field.openclaw.reply")

                Button {
                    sendCurrentReply()
                } label: {
                    if isSending {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.headline.weight(.bold))
                    }
                }
                .frame(width: 38, height: 38)
                .background(canSendCurrentReply ? palette.accent : palette.border, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .foregroundStyle(canSendCurrentReply ? .white : .secondary)
                .disabled(!canSendCurrentReply)
                .accessibilityLabel("Send reply")
                .accessibilityIdentifier("button.openclaw.send-reply")
            }
            .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
            .padding(.bottom, 10)
        }
        .background(.regularMaterial)
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
