import SwiftUI

struct AlertLinksCard: View {
    let alert: AlertItem

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Links")

            if let webURL = alert.webURL {
                Link(destination: webURL) {
                    HStack {
                        Label("Open Cowtail Web", systemImage: "globe")
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.footnote.weight(.semibold))
                    }
                    .font(.cowtailSans(15, weight: .medium, relativeTo: .subheadline))
                }
            }
        }
    }
}
