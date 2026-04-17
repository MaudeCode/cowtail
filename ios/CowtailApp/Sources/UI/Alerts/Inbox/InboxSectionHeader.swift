import SwiftUI

struct InboxSectionHeader: View {
    let title: String
    let detail: String

    var body: some View {
        CowtailSectionHeader(title: title, detail: detail)
    }
}
