import SwiftUI

struct OpenClawNewThreadView: View {
    @Environment(\.cowtailPalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: OpenClawStore

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

                        CowtailCard {
                            VStack(alignment: .leading, spacing: 12) {
                                CowtailSectionHeader(title: "Thread")

                                TextField("Title", text: $titleText)
                                    .textFieldStyle(.roundedBorder)
                                    .accessibilityIdentifier("field.openclaw.new-thread.title")

                                TextField("Message", text: $messageText, axis: .vertical)
                                    .textFieldStyle(.roundedBorder)
                                    .lineLimit(4...10)
                                    .accessibilityIdentifier("field.openclaw.new-thread.message")
                            }
                        }

                        if let errorMessage {
                            CowtailCard {
                                CowtailSectionHeader(title: "Send Error")
                                Text(errorMessage)
                                    .font(.cowtailSans(13, relativeTo: .footnote))
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                    .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                    .padding(.top, CowtailDesignGuide.pageTopPadding)
                    .padding(.bottom, 24)
                }
            }
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
                try await store.createThread(
                    title: title.isEmpty ? nil : title,
                    text: message
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    OpenClawNewThreadView()
        .environmentObject(CowtailPreviewFixtures.openClawStore())
}
