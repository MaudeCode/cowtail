import SwiftUI

struct CowtailMonoLabel: View {
    @Environment(\.cowtailPalette) private var palette

    let text: String
    var tint: Color?

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .tracking(1.2)
            .textCase(.uppercase)
            .foregroundStyle(tint ?? palette.mutedInk)
    }
}
