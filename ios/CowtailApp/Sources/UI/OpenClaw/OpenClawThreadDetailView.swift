import SwiftUI

struct OpenClawThreadDetailView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore

    let threadID: String

    @State private var replyText = ""
    @State private var isSending = false
    @State private var localErrorMessage: String?

    private var thread: OpenClawThread? {
        store.threads.first { $0.id == threadID }
    }

    private var messages: [OpenClawMessageWithActions] {
        store.messagesByThreadID[threadID] ?? []
    }

    var body: some View {
        CowtailCanvas {
            VStack(spacing: 0) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        detailHeader

                        if let errorMessage = localErrorMessage ?? store.errorMessage {
                            errorCard(message: errorMessage)
                        }

                        if messages.isEmpty {
                            emptyMessagesCard
                        } else {
                            ForEach(messages) { message in
                                OpenClawMessageBubble(message: message)
                            }
                        }
                    }
                    .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                    .padding(.top, CowtailDesignGuide.pageTopPadding)
                    .padding(.bottom, 12)
                }

                composer
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.openclaw.thread-detail")
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
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
        CowtailCard {
            VStack(alignment: .leading, spacing: 8) {
                CowtailMonoLabel(text: "OpenClaw Thread")
                Text(thread?.title ?? "Thread")
                    .font(.cowtailSans(22, weight: .bold, relativeTo: .title2))
                    .foregroundStyle(palette.ink)
                    .lineLimit(3)

                if let thread {
                    HStack(spacing: 8) {
                        CowtailStatusBadge(title: thread.status.displayTitle, tint: thread.status.tint)
                        Text(thread.targetAgent)
                            .font(.cowtailSans(13, relativeTo: .footnote))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
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

    private var composer: some View {
        VStack(spacing: 10) {
            Divider()

            HStack(alignment: .bottom, spacing: 10) {
                TextField("Reply", text: $replyText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                    .accessibilityIdentifier("field.openclaw.reply")

                Button {
                    sendReply()
                } label: {
                    if isSending {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.headline.weight(.bold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(palette.accent)
                .disabled(trimmedReply.isEmpty || isSending)
                .accessibilityLabel("Send reply")
                .accessibilityIdentifier("button.openclaw.send-reply")
            }
            .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
            .padding(.bottom, 10)
        }
        .background(palette.surfaceRaised)
    }

    private var trimmedReply: String {
        replyText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sendReply() {
        let text = trimmedReply
        guard !text.isEmpty else { return }

        isSending = true
        localErrorMessage = nil
        Task {
            defer {
                isSending = false
            }

            do {
                try await store.sendReply(threadId: threadID, text: text)
                replyText = ""
            } catch {
                localErrorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    NavigationStack {
        OpenClawThreadDetailView(threadID: CowtailPreviewFixtures.openClawThread.id)
            .environmentObject(CowtailPreviewFixtures.openClawStore())
    }
}
