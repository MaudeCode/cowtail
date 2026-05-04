import SwiftUI

struct OpenClawThreadListView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    @State private var isShowingNewThread = false
    @State private var renameTarget: OpenClawThread?
    @State private var deleteTarget: OpenClawThread?

    var body: some View {
        OpenClawScreen {
            threadList
        }
        .openClawStyle(OpenClawStyle(palette: palette))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.openclaw.threads")
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $isShowingNewThread) {
            OpenClawNewThreadView()
                .environmentObject(store)
        }
        .sheet(item: $renameTarget) { thread in
            OpenClawRenameThreadView(thread: thread)
                .environmentObject(store)
        }
        .alert(
            "Delete Thread",
            isPresented: deleteConfirmationPresented,
            presenting: deleteTarget
        ) { thread in
            Button("Delete Thread", role: .destructive) {
                delete(thread)
            }
            .accessibilityIdentifier("button.openclaw.thread-delete.confirm.\(thread.id)")

            Button("Cancel", role: .cancel) {
                deleteTarget = nil
            }
            .accessibilityIdentifier("button.openclaw.thread-delete.cancel.\(thread.id)")
        } message: { thread in
            Text("Delete \"\(thread.title)\" from OpenClaw.")
        }
        .task {
            await store.refreshIfPossible()
        }
    }

    private var threadList: some View {
        List {
            pageHeader
                .listRowInsets(
                    EdgeInsets(
                        top: CowtailDesignGuide.pageTopPadding,
                        leading: CowtailDesignGuide.pageHorizontalPadding,
                        bottom: 8,
                        trailing: CowtailDesignGuide.pageHorizontalPadding
                    )
                )
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            if let errorMessage = store.errorMessage {
                errorCard(message: errorMessage)
                    .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 5, trailing: 14))
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
                    .listRowInsets(EdgeInsets(top: 10, leading: 18, bottom: 2, trailing: 18))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)

                ForEach(store.threads) { thread in
                    threadRow(thread)
                        .listRowInsets(EdgeInsets(top: 0, leading: 14, bottom: 0, trailing: 14))
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

    private var pageHeader: some View {
        CowtailPageHeader(title: headerTitle) {
            Button {
                isShowingNewThread = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(style.elevatedSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(style.border, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .foregroundStyle(style.primaryText)
            .accessibilityLabel("New OpenClaw thread")
            .accessibilityIdentifier("button.openclaw.new-thread")
        }
    }

    private var threadSectionHeader: some View {
        HStack(spacing: 8) {
            Text("Conversations")
                .font(.cowtailSans(12, weight: .semibold, relativeTo: .caption))
                .foregroundStyle(style.secondaryText)
                .textCase(.uppercase)
            Spacer(minLength: 0)
            Text("\(store.threads.count)")
                .font(.cowtailMono(11, relativeTo: .caption2))
                .foregroundStyle(style.secondaryText)
        }
    }

    private func threadRow(_ thread: OpenClawThread) -> some View {
        Button {
            universalLinkRouter.openClawPath = [.thread(thread.id)]
        } label: {
            OpenClawThreadRow(thread: thread)
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
        OpenClawInlineBanner(
            title: "Signed Out",
            message: "Sign in from Farmhouse to use OpenClaw threads.",
            tint: store.connectionState.tint,
            systemImage: "person.crop.circle.badge.exclamationmark"
        )
        .accessibilityIdentifier("card.openclaw.signed-out")
    }

    private var emptyCard: some View {
        OpenClawInlineBanner(
            title: "No Threads",
            message: "Start a thread when you need OpenClaw to help with a cluster task.",
            tint: style.info,
            systemImage: "bubble.left.and.bubble.right"
        )
        .accessibilityIdentifier("card.openclaw.empty")
    }

    private func errorCard(message: String) -> some View {
        OpenClawInlineBanner(
            title: "OpenClaw Error",
            message: message,
            tint: .red,
            systemImage: "exclamationmark.triangle",
            messageLineLimit: nil
        )
    }

    private var displayName: String {
        let trimmed = store.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "OpenClaw" : trimmed
    }

    private var headerDisplayName: String {
        displayName.uppercased()
    }

    private var headerTitle: CowtailPageHeaderTitle {
        let words = headerDisplayName.split(whereSeparator: \.isWhitespace).map(String.init)
        guard words.count == 2 else {
            return .title(headerDisplayName)
        }

        return .split(leading: words[0], trailing: words[1])
    }

    private var style: OpenClawStyle {
        OpenClawStyle(palette: palette)
    }

    private var deleteConfirmationPresented: Binding<Bool> {
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
