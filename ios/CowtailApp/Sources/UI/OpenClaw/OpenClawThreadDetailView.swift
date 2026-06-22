import SwiftUI

struct OpenClawThreadDetailView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore

    let threadID: String

    @State private var isNearBottom = true
    @State private var shouldAutoScrollToBottom = true
    @State private var userScrollIsActive = false
    @State private var userHasScrolledTranscript = false
    @State private var hasCompletedInitialScroll = false

    private let bottomAnchorID = "openclaw-thread-bottom"
    private let bottomPinnedThreshold: CGFloat = 48

    private var thread: OpenClawThread? {
        store.threads.first { $0.id == threadID }
    }

    private var messages: [OpenClawMessageWithActions] {
        store.messagesByThreadID[threadID] ?? []
    }

    private var messageScrollSignature: [String] {
        messages.map { message in
            let toolSignature = message.toolCalls.map {
                [
                    $0.id,
                    $0.status.rawValue,
                    "\($0.completedAt ?? 0)",
                    String(describing: $0.result)
                ].joined(separator: ":")
            }.joined(separator: ",")
            let actionSignature = message.actions.map {
                "\($0.id):\($0.state.rawValue):\($0.updatedAt)"
            }.joined(separator: ",")

            return [
                message.id,
                "\(message.updatedAt)",
                message.deliveryState.rawValue,
                "\(message.text.count)",
                toolSignature,
                actionSignature
            ].joined(separator: ":")
        }
    }

    private var style: OpenClawStyle {
        OpenClawStyle(palette: palette)
    }

    var body: some View {
        OpenClawScreen {
            ScrollViewReader { proxy in
                ZStack(alignment: .bottomTrailing) {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: style.transcriptSpacing) {
                            readOnlyCard

                            if let errorMessage = store.errorMessage {
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
                    .accessibilityIdentifier("scroll.openclaw.transcript")
                    .onScrollGeometryChange(for: CGFloat.self) { geometry in
                        max(0, geometry.contentSize.height - geometry.visibleRect.maxY)
                    } action: { _, newBottomDistance in
                        updateBottomPinState(bottomDistance: newBottomDistance)
                    }
                    .onScrollPhaseChange { _, newPhase in
                        switch newPhase {
                        case .tracking, .interacting, .decelerating:
                            userScrollIsActive = true
                            userHasScrolledTranscript = true
                        case .idle, .animating:
                            userScrollIsActive = false
                        }
                        if newPhase == .idle, isNearBottom {
                            userHasScrolledTranscript = false
                            shouldAutoScrollToBottom = true
                        }
                    }

                    if hasCompletedInitialScroll && userHasScrolledTranscript && !isNearBottom {
                        scrollToBottomButton {
                            shouldAutoScrollToBottom = true
                            scrollToBottom(proxy: proxy, animated: true)
                        }
                        .padding(.trailing, style.transcriptHorizontalPadding)
                        .padding(.bottom, 18)
                    }
                }
                .onAppear {
                    Task { @MainActor in
                        await Task.yield()
                        scrollToBottom(proxy: proxy, animated: false)
                    }
                }
                .onChange(of: messages.map(\.id)) { _, _ in
                    requestScrollToBottom(proxy: proxy, animated: true)
                }
                .onChange(of: messageScrollSignature) { _, _ in
                    requestScrollToBottom(proxy: proxy, animated: true)
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
        }
        .task(id: threadID) {
            await store.loadMessages(threadId: threadID)
        }
    }

    private var threadTitlePill: some View {
        Text(thread?.title ?? "Thread")
            .font(.cowtailSans(15, weight: .semibold, relativeTo: .headline))
            .foregroundStyle(style.primaryText)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .frame(maxWidth: 230)
            .background(style.floatingChromeSurface, in: Capsule())
            .overlay {
                Capsule()
                    .stroke(style.border, lineWidth: 1)
            }
            .accessibilityIdentifier("title.openclaw.thread")
    }

    private var readOnlyCard: some View {
        OpenClawInlineBanner(
            title: "Read Only",
            message: "This archived conversation no longer supports live replies or actions.",
            tint: style.info,
            systemImage: "archivebox"
        )
        .accessibilityIdentifier("card.openclaw.thread-read-only")
    }

    private var emptyMessagesCard: some View {
        OpenClawInlineBanner(
            title: "No Messages",
            message: "Messages for this thread have not loaded yet.",
            tint: .gray,
            systemImage: "bubble.left"
        )
    }

    private func scrollToBottomButton(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(style.accent, in: Circle())
                .overlay {
                    Circle()
                        .stroke(style.border.opacity(0.7), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.24), radius: 14, x: 0, y: 8)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Scroll to bottom")
        .accessibilityIdentifier("button.openclaw.scroll-to-bottom")
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

    private func requestScrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        guard shouldAutoScrollToBottom else { return }

        Task { @MainActor in
            await Task.yield()
            scrollToBottom(proxy: proxy, animated: animated)
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        let action = {
            isNearBottom = true
            shouldAutoScrollToBottom = true
            userHasScrolledTranscript = false
            hasCompletedInitialScroll = true
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }

        if animated {
            withAnimation(.easeOut(duration: 0.2), action)
        } else {
            action()
        }
    }

    private func updateBottomPinState(bottomDistance: CGFloat) {
        guard hasCompletedInitialScroll else {
            isNearBottom = true
            shouldAutoScrollToBottom = true
            return
        }

        let newIsNearBottom = bottomDistance <= bottomPinnedThreshold
        isNearBottom = newIsNearBottom

        if newIsNearBottom {
            userHasScrolledTranscript = false
            shouldAutoScrollToBottom = true
        } else if userHasScrolledTranscript || userScrollIsActive {
            shouldAutoScrollToBottom = false
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
