import SwiftUI

private struct CowtailGridPattern: View {
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        GeometryReader { geometry in
            Path { path in
                let step: CGFloat = 42
                var x: CGFloat = 0
                while x <= geometry.size.width {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: geometry.size.height))
                    x += step
                }

                var y: CGFloat = 0
                while y <= geometry.size.height {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: geometry.size.width, y: y))
                    y += step
                }
            }
            .stroke(palette.gridLine, lineWidth: 1)
        }
        .allowsHitTesting(false)
    }
}

struct CowtailCanvas<Content: View>: View {
    @Environment(\.cowtailPalette) private var palette
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            palette.canvas
                .ignoresSafeArea()

            CowtailGridPattern()
                .ignoresSafeArea()

            LinearGradient(
                colors: [palette.accentSoft, .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            content()
        }
        .font(.cowtailSans(15, relativeTo: .body))
        .foregroundStyle(palette.ink)
    }
}
