import SwiftUI

struct OpenClawThreadListView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    @State private var isShowingNewThread = false
    @State private var renameTarget: OpenClawThread?
    @State private var deleteTarget: OpenClawThread?

    var body: some View {
        CowtailCanvas {
            List {
                header
                    .listRowInsets(
                        EdgeInsets(
                            top: CowtailDesignGuide.pageTopPadding,
                            leading: 14,
                            bottom: 5,
                            trailing: 14
                        )
                    )
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)

                if let errorMessage = store.errorMessage {
                    errorCard(message: errorMessage)
                        .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 14))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }

                if store.connectionState == .signedOut {
                    signedOutCard
                        .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 18, trailing: 14))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                } else if store.threads.isEmpty {
                    emptyCard
                        .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 18, trailing: 14))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                } else {
                    threadSectionHeader
                        .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 3, trailing: 14))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)

                    ForEach(store.threads) { thread in
                        threadRow(thread)
                            .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 14))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.clear)
            .refreshable {
                await store.refreshIfPossible()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.openclaw.threads")
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isShowingNewThread = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New OpenClaw thread")
                .accessibilityIdentifier("button.openclaw.new-thread")
            }
        }
        .sheet(isPresented: $isShowingNewThread) {
            OpenClawNewThreadView()
                .environmentObject(store)
        }
        .sheet(item: $renameTarget) { thread in
            OpenClawRenameThreadView(thread: thread)
                .environmentObject(store)
        }
        .confirmationDialog(
            "Delete Thread",
            isPresented: deleteDialogBinding,
            presenting: deleteTarget
        ) { thread in
            Button("Delete Thread", role: .destructive) {
                delete(thread)
            }
        } message: { thread in
            Text("Delete \"\(thread.title)\" from OpenClaw.")
        }
        .task {
            await store.refreshIfPossible()
        }
    }

    private var header: some View {
        CowtailCard {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    CowtailMonoLabel(text: "OpenClaw")
                    Text(displayName)
                        .font(.cowtailSans(24, weight: .bold, relativeTo: .title2))
                        .foregroundStyle(palette.ink)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                CowtailStatusBadge(
                    title: store.connectionState.displayTitle,
                    tint: store.connectionState.tint
                )
            }
        }
    }

    private var threadSectionHeader: some View {
        InboxSectionHeader(title: "Conversations", detail: "\(store.threads.count)")
    }

    private func threadRow(_ thread: OpenClawThread) -> some View {
        Button {
            universalLinkRouter.openClawPath = [.thread(thread.id)]
        } label: {
            OpenClawThreadRow(thread: thread)
                .cowtailCard()
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                deleteTarget = thread
            } label: {
                Label("Delete", systemImage: "trash")
            }

            Button {
                renameTarget = thread
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            .tint(.blue)
        }
        .contextMenu {
            Button {
                renameTarget = thread
            } label: {
                Label("Rename", systemImage: "pencil")
            }

            Button(role: .destructive) {
                deleteTarget = thread
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .accessibilityIdentifier("row.openclaw.thread.\(thread.id)")
    }

    private var signedOutCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Signed Out")
            Text("Sign in from Farmhouse to use OpenClaw threads.")
                .font(.cowtailSans(15, relativeTo: .subheadline))
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("card.openclaw.signed-out")
    }

    private var emptyCard: some View {
        CowtailCard {
            CowtailSectionHeader(title: "No Threads")
            Text("Start a thread when you need OpenClaw to help with a cluster task.")
                .font(.cowtailSans(15, relativeTo: .subheadline))
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("card.openclaw.empty")
    }

    private func errorCard(message: String) -> some View {
        CowtailCard {
            CowtailSectionHeader(title: "OpenClaw Error")
            Text(message)
                .font(.cowtailSans(13, relativeTo: .footnote))
                .foregroundStyle(.red)
        }
    }

    private var displayName: String {
        let trimmed = store.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "OpenClaw" : trimmed
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: { isPresented in
                if !isPresented {
                    deleteTarget = nil
                }
            }
        )
    }

    private func delete(_ thread: OpenClawThread) {
        Task {
            do {
                try await store.deleteThread(threadId: thread.id)
                if universalLinkRouter.openClawPath == [.thread(thread.id)] {
                    universalLinkRouter.openClawPath.removeAll()
                }
            } catch {
                store.errorMessage = error.localizedDescription
            }
            deleteTarget = nil
        }
    }
}

extension OpenClawConnectionState {
    var displayTitle: String {
        switch self {
        case .disconnected:
            return "Offline"
        case .signedOut:
            return "Signed Out"
        case .connecting:
            return "Connecting"
        case .connected:
            return "Connected"
        case .reconnecting:
            return "Reconnecting"
        case .failed:
            return "Failed"
        }
    }

    var tint: Color {
        switch self {
        case .disconnected, .signedOut:
            return .gray
        case .connecting, .reconnecting:
            return .orange
        case .connected:
            return .green
        case .failed:
            return .red
        }
    }
}

#Preview {
    NavigationStack {
        OpenClawThreadListView()
            .environmentObject(CowtailPreviewFixtures.openClawStore())
            .environmentObject(UniversalLinkRouter.shared)
    }
}
