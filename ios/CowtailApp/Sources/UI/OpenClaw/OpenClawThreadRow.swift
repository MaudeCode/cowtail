import SwiftUI

struct OpenClawThreadRow: View {
    @Environment(\.openClawStyle) private var style

    let thread: OpenClawThread

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(thread.unreadCount > 0 ? style.accentSoft : style.transcriptHoverSurface)
                .overlay(Circle().stroke(thread.unreadCount > 0 ? style.accent.opacity(0.28) : style.border.opacity(0.8), lineWidth: 1))
                .frame(width: style.avatarSize, height: style.avatarSize)
                .overlay {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(thread.unreadCount > 0 ? style.accent : style.secondaryText)
                }
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(thread.title)
                        .font(.cowtailSans(15, weight: .semibold, relativeTo: .headline))
                        .foregroundStyle(style.primaryText)
                        .lineLimit(2)
                    Spacer(minLength: 8)
                    Text(activityText)
                        .font(.cowtailSans(11, relativeTo: .caption2))
                        .foregroundStyle(style.secondaryText)
                        .lineLimit(1)
                }

                if thread.status != .active {
                    Text(thread.status.displayTitle)
                        .font(.cowtailSans(12, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(style.secondaryText)
                }
            }

            if thread.unreadCount > 0 {
                Text(unreadCountText)
                    .font(.cowtailSans(11, weight: .bold, relativeTo: .caption2))
                    .foregroundStyle(.white)
                    .frame(minWidth: 22, minHeight: 22)
                    .padding(.horizontal, thread.unreadCount > 9 ? 4 : 0)
                    .background(style.accent, in: Capsule())
                    .accessibilityLabel("\(thread.unreadCount) unread")
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(style.border.opacity(0.65))
                .frame(height: 1)
        }
        .contentShape(Rectangle())
    }

    private var activityText: String {
        let timestamp = thread.lastMessageAt ?? thread.updatedAt
        let date = Date(timeIntervalSince1970: TimeInterval(timestamp) / 1_000)
        return "Updated \(date.formatted(.relative(presentation: .named)))"
    }

    private var unreadCountText: String {
        thread.unreadCount > 99 ? "99+" : "\(thread.unreadCount)"
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
}

#Preview {
    OpenClawThreadRow(thread: CowtailPreviewFixtures.openClawThread)
        .padding()
        .background(Color.black)
}
