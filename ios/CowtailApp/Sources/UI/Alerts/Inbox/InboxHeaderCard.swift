import SwiftUI

struct InboxHeaderCard: View {
    let lastUpdated: Date?

    var body: some View {
        CowtailBrandHeader {
            CowtailMonoLabel(text: Self.updatedLabel(for: lastUpdated))
        }
    }

    static func updatedLabel(
        for lastUpdated: Date?,
        timeZone: TimeZone = .autoupdatingCurrent,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        guard let lastUpdated else {
            return "Updated --"
        }

        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .medium
        return "Updated \(formatter.string(from: lastUpdated))"
    }
}

#Preview {
    InboxHeaderCard(lastUpdated: .now)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
}
