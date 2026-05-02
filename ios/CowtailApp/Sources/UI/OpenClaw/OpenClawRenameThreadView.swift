import SwiftUI

struct OpenClawRenameThreadView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: OpenClawStore

    let thread: OpenClawThread

    @State private var titleText: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var titleIsFocused: Bool

    init(thread: OpenClawThread) {
        self.thread = thread
        _titleText = State(initialValue: thread.title)
    }

    var body: some View {
        NavigationStack {
            CowtailCanvas {
                VStack(spacing: CowtailDesignGuide.topLevelSpacing) {
                    CowtailPageHeader(title: .title("Rename Thread"))

                    CowtailCard {
                        VStack(alignment: .leading, spacing: 12) {
                            CowtailSectionHeader(title: "Title")

                            TextField("Title", text: $titleText)
                                .focused($titleIsFocused)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("field.openclaw.rename-thread.title")
                        }
                    }

                    if let errorMessage {
                        CowtailCard {
                            CowtailSectionHeader(title: "Rename Error")
                            Text(errorMessage)
                                .font(.cowtailSans(13, relativeTo: .footnote))
                                .foregroundStyle(.red)
                        }
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, CowtailDesignGuide.pageHorizontalPadding)
                .padding(.top, CowtailDesignGuide.pageTopPadding)
                .padding(.bottom, 24)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("sheet.openclaw.rename-thread")
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
                        save()
                    } label: {
                        if isSaving {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(!canSave)
                    .accessibilityIdentifier("button.openclaw.rename-thread.save")
                }
            }
            .task {
                titleIsFocused = true
            }
        }
    }

    private var trimmedTitle: String {
        titleText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        !trimmedTitle.isEmpty && trimmedTitle != thread.title && !isSaving
    }

    private func save() {
        guard canSave else { return }

        isSaving = true
        errorMessage = nil
        Task {
            defer {
                isSaving = false
            }

            do {
                try await store.renameThread(threadId: thread.id, title: trimmedTitle)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    OpenClawRenameThreadView(thread: CowtailPreviewFixtures.openClawThread)
        .environmentObject(CowtailPreviewFixtures.openClawStore())
}
