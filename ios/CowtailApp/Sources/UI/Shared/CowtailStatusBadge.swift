import SwiftUI

/// A chip: kind, urgency, state, outcome, a filter, or a status with its dot.
struct CowtailStatusBadge: View {
    @Environment(\.cowtailPalette) private var palette

    let title: String
    var tint: Color?
    var showsDot = false
    /// A glyph before the title, such as the incident chip's layers.
    var systemImage: String?

    var body: some View {
        HStack(spacing: 5) {
            if showsDot {
                Circle()
                    .fill(color)
                    .frame(width: 6, height: 6)
            }
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 9, weight: .semibold))
                    .accessibilityHidden(true)
            }
            Text(title)
                .font(.cowtailMono(11, weight: .medium, relativeTo: .caption2))
                .lineLimit(1)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.28), lineWidth: 0.5))
    }

    private var color: Color {
        tint ?? palette.mutedInk
    }
}
