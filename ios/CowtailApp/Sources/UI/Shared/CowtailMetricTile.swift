import SwiftUI

struct CowtailMetricTile: View {
    @Environment(\.cowtailPalette) private var palette

    let value: String
    let title: String
    let tint: Color
    var usesAccentBackground = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.cowtailSans(24, weight: .bold, relativeTo: .title2))
                .foregroundStyle(tint)

            CowtailMonoLabel(text: title)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(tileBackground)
    }

    @ViewBuilder
    private var tileBackground: some View {
        if usesAccentBackground {
            Rectangle()
                .fill(palette.accentSoft.opacity(0.7))
        } else {
            Color.clear
        }
    }
}
