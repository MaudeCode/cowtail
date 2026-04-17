import SwiftUI

struct RoundupHeroCard: View {
    let dateRangeText: String

    var body: some View {
        CowtailPageHeader(title: .split(leading: CowtailCopy.roundupBrandLeading, trailing: CowtailCopy.roundupBrandTrailing)) {
            CowtailMonoLabel(text: dateRangeText.uppercased())
        }
    }
}
