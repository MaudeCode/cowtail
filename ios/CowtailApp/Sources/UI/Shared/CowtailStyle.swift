import SwiftUI

struct CowtailCanvas<Content: View>: View {
    @Environment(\.cowtailPalette) private var palette
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            palette.canvas
                .ignoresSafeArea()

            LinearGradient(
                colors: [
                    Color.white.opacity(0.04),
                    Color.clear,
                    palette.accentSoft.opacity(0.42)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            content()
        }
        .foregroundStyle(palette.ink)
    }
}

struct CowtailHeroCard<Content: View>: View {
    let gradient: LinearGradient
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(gradient, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 18, y: 10)
    }
}

struct CowtailCardModifier: ViewModifier {
    @Environment(\.cowtailPalette) private var palette

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(palette.cardBorder, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.22), radius: 18, y: 10)
    }
}

extension View {
    func cowtailCard() -> some View {
        modifier(CowtailCardModifier())
    }
}

struct CowtailCardStyle: GroupBoxStyle {
    @Environment(\.cowtailPalette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            configuration.label
                .font(.caption.weight(.bold))
                .foregroundStyle(palette.storm.opacity(0.75))
                .textCase(.uppercase)

            configuration.content
        }
        .cowtailCard()
    }
}

struct CowtailMetricTile: View {
    let value: String
    let title: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .bold))
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
