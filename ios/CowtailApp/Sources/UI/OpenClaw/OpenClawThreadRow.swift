import SwiftUI

struct OpenClawThreadRow: View {
    @Environment(\.cowtailPalette) private var palette

    let thread: OpenClawThread

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(thread.title)
                    .font(.cowtailSans(16, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(palette.ink)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    CowtailStatusBadge(title: thread.status.displayTitle, tint: thread.status.tint)

                    Text(thread.targetAgent)
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if thread.unreadCount > 0 {
                Text("\(thread.unreadCount)")
                    .font(.cowtailSans(12, weight: .bold, relativeTo: .caption))
                    .foregroundStyle(.white)
                    .frame(minWidth: 24, minHeight: 24)
                    .padding(.horizontal, thread.unreadCount > 9 ? 4 : 0)
                    .background(palette.accent, in: Capsule())
                    .accessibilityLabel("\(thread.unreadCount) unread")
            }

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

extension OpenClawThreadStatus {
    var displayTitle: String {
        switch self {
        case .pending:
            return "Pending"
        case .active:
            return "Active"
        case .archived:
            return "Archived"
        }
    }

    var tint: Color {
        switch self {
        case .pending:
            return .orange
        case .active:
            return .green
        case .archived:
            return .gray
        }
    }
}

#Preview {
    OpenClawThreadRow(thread: CowtailPreviewFixtures.openClawThread)
        .padding()
        .background(Color.black)
}
