import SwiftUI

struct CowtailMonoLabel: View {
    @Environment(\.cowtailPalette) private var palette

    let text: String
    var tint: Color?

    var body: some View {
        Text(text)
            .font(.cowtailMono(10, weight: .medium, relativeTo: .caption2))
            .tracking(1.2)
            .textCase(.uppercase)
            .foregroundStyle(tint ?? palette.mutedInk)
    }
}
