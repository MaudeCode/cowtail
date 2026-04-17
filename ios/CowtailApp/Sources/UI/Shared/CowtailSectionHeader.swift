import SwiftUI

struct CowtailSectionHeader: View {
    @Environment(\.cowtailPalette) private var palette

    let title: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            CowtailMonoLabel(text: title)
            Spacer()
            if let detail, !detail.isEmpty {
                CowtailMonoLabel(text: detail, tint: palette.ink)
            }
        }
    }
}
