import SwiftUI

struct CowtailMetricTile: View {
    @Environment(\.cowtailPalette) private var palette

    let value: String
    let title: String
    let tint: Color
    var usesAccentBackground = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(tint)

            CowtailMonoLabel(text: title)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(usesAccentBackground ? palette.accentSoft : Color.white.opacity(0.015))
    }
}
