import SwiftUI

struct CowtailHeroCard<Content: View>: View {
    @Environment(\.cowtailPalette) private var palette
    var gradient: LinearGradient? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background {
            RoundedRectangle(cornerRadius: CowtailDesignGuide.cardCornerRadius, style: .continuous)
                .fill(backgroundStyle)
        }
        .overlay(
            RoundedRectangle(cornerRadius: CowtailDesignGuide.cardCornerRadius, style: .continuous)
                .stroke(palette.border, lineWidth: 1)
        )
    }

    private var backgroundStyle: AnyShapeStyle {
        if let gradient {
            AnyShapeStyle(gradient)
        } else {
            AnyShapeStyle(palette.surfaceRaised)
        }
    }
}
