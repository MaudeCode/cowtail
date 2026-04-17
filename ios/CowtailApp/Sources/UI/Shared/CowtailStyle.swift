import SwiftUI

struct CowtailCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        CowtailCard {
            content
        }
    }
}

extension View {
    func cowtailCard() -> some View {
        modifier(CowtailCardModifier())
    }
}

struct CowtailCardStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        CowtailCard {
            configuration.label
            configuration.content
        }
    }
}
