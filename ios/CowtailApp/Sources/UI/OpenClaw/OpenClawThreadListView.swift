import SwiftUI

struct OpenClawThreadListView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore

    @State private var isShowingNewThread = false

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

                content
                    .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 18, trailing: 14))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
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

    @ViewBuilder
    private var content: some View {
        if store.connectionState == .signedOut {
            signedOutCard
        } else if store.threads.isEmpty {
            emptyCard
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(store.threads.enumerated()), id: \.element.id) { index, thread in
                    NavigationLink(value: OpenClawRoute.thread(thread.id)) {
                        OpenClawThreadRow(thread: thread)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("row.openclaw.thread.\(thread.id)")

                    if index < store.threads.count - 1 {
                        Divider()
                            .padding(.leading, 2)
                    }
                }
            }
            .cowtailCard()
        }
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
        case .failed:
            return "Failed"
        }
    }

    var tint: Color {
        switch self {
        case .disconnected, .signedOut:
            return .gray
        case .connecting:
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
    }
}
