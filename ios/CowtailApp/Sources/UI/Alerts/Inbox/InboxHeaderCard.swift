import SwiftUI

struct InboxHeaderCard: View {
    let lastUpdated: Date?

    var body: some View {
        CowtailBrandHeader {
            CowtailMonoLabel(
                text: "Updated \(lastUpdated?.formatted(date: .omitted, time: .shortened) ?? "--")"
            )
        }
    }
}

#Preview {
    InboxHeaderCard(lastUpdated: .now)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
