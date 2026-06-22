import SwiftUI

struct OpenClawThreadListView: View {
    @Environment(\.cowtailPalette) private var palette
    @EnvironmentObject private var store: OpenClawStore
    @EnvironmentObject private var universalLinkRouter: UniversalLinkRouter

    var body: some View {
        OpenClawScreen {
            threadList
        }
        .openClawStyle(OpenClawStyle(palette: palette))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.openclaw.threads")
        .toolbar(.hidden, for: .navigationBar)
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

            readOnlyCard
                .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 8, trailing: 14))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            if let errorMessage = store.errorMessage {
                errorCard(message: errorMessage)
                    .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 5, trailing: 14))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }

            if store.isSignedOut {
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
        CowtailPageHeader(title: headerTitle)
    }

    private var readOnlyCard: some View {
        OpenClawInlineBanner(
            title: "Read Only",
            message: "Live replies and thread changes were retired with the bridge.",
            tint: style.info,
            systemImage: "archivebox"
        )
        .accessibilityIdentifier("card.openclaw.read-only")
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
        .accessibilityIdentifier("row.openclaw.thread.\(thread.id)")
    }

    private var signedOutCard: some View {
        OpenClawInlineBanner(
            title: "Signed Out",
            message: "Sign in from Farmhouse to view OpenClaw threads.",
            tint: style.warning,
            systemImage: "person.crop.circle.badge.exclamationmark"
        )
        .accessibilityIdentifier("card.openclaw.signed-out")
    }

    private var emptyCard: some View {
        OpenClawInlineBanner(
            title: "No Threads",
            message: "No archived OpenClaw conversations are available.",
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
}
