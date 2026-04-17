import SwiftUI

struct AlertTextSectionCard: View {
    let title: String
    let bodyText: String

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: title)
            Text(bodyText)
                .font(.cowtailSans(17, relativeTo: .body))
        }
    }
}
