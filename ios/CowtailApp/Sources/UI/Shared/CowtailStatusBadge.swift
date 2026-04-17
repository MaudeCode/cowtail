import SwiftUI

struct CowtailStatusBadge: View {
    let title: String
    let tint: Color

    var body: some View {
        Text(title)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .tracking(1.0)
            .textCase(.uppercase)
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(tint, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}
