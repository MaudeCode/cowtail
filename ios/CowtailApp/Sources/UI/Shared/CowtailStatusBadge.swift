import SwiftUI

struct CowtailStatusBadge: View {
    let title: String
    let tint: Color

    var body: some View {
        Text(title)
            .font(.cowtailMono(10, weight: .medium, relativeTo: .caption2))
            .tracking(1.0)
            .textCase(.uppercase)
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(tint, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}
