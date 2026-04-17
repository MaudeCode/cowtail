import SwiftUI

struct InboxSectionToggleButton: View {
    @Environment(\.cowtailPalette) private var palette

    let isExpanded: Bool
    let collapsedTitle: String
    let expandedTitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(isExpanded ? expandedTitle : collapsedTitle)
                    .font(.cowtailSans(15, weight: .semibold, relativeTo: .subheadline))
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(palette.accent)
        }
        .buttonStyle(.plain)
    }
}
