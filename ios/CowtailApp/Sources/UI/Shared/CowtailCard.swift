import SwiftUI

struct CowtailCard<Content: View>: View {
    @Environment(\.cowtailPalette) private var palette
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(CowtailDesignGuide.cardPadding)
        .background(
            palette.surface,
            in: RoundedRectangle(cornerRadius: CowtailDesignGuide.cardCornerRadius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: CowtailDesignGuide.cardCornerRadius, style: .continuous)
                .stroke(palette.border, lineWidth: 1)
        )
    }
}
