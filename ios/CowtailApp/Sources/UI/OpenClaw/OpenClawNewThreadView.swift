import SwiftUI

struct OpenClawNewThreadView: View {
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    @State private var titleText = ""
    @State private var messageText = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            CowtailCanvas {
                ScrollView {
                    VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                        CowtailPageHeader(title: .title("New OpenClaw Thread"))

                        VStack(alignment: .leading, spacing: 12) {
                            Text("Thread")
                                .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                                .foregroundStyle(style.secondaryText)

                            TextField("Title", text: $titleText)
                                .openClawFieldChrome()
                                .accessibilityIdentifier("field.openclaw.new-thread.title")

                            TextField("Message", text: $messageText, axis: .vertical)
                                .openClawFieldChrome()
                                .lineLimit(4...10)
                                .accessibilityIdentifier("field.openclaw.new-thread.message")
                        }

                        if let errorMessage {
                            OpenClawInlineBanner(
                                title: "Send Error",
                                message: errorMessage,
                                tint: .red,
                                systemImage: "exclamationmark.triangle",
                                messageLineLimit: nil
                            )
                        }
                    }
                    .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                    .padding(.top, CowtailDesignGuide.pageTopPadding)
                    .padding(.bottom, 24)
                }
            }
            .openClawStyle(OpenClawStyle(palette: palette))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("sheet.openclaw.new-thread")
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        send()
                    } label: {
                        if isSending {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text("Send")
                        }
                    }
                    .disabled(trimmedMessage.isEmpty || isSending)
                    .accessibilityIdentifier("button.openclaw.new-thread.send")
                }
            }
        }
    }

    private var trimmedTitle: String {
        titleText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var style: OpenClawStyle {
        OpenClawStyle(palette: palette)
    }

    private var trimmedMessage: String {
        messageText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func send() {
        let title = trimmedTitle
        let message = trimmedMessage
        guard !message.isEmpty else { return }

        isSending = true
        errorMessage = nil
        Task {
            defer {
                isSending = false
            }

            do {
                let threadId = try await store.createThread(
                    title: title.isEmpty ? nil : title,
                    text: message
                )
                dismiss()
                if let threadId {
                    universalLinkRouter.openOpenClawThread(threadId)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    OpenClawNewThreadView()
        .environmentObject(CowtailPreviewFixtures.openClawStore())
        .environmentObject(UniversalLinkRouter.shared)
}
