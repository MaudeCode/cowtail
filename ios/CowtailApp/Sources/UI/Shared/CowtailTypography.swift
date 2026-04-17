import SwiftUI

enum CowtailTypography {
    static let bundledFontFiles = [
        "SpaceGrotesk-Regular.ttf",
        "SpaceGrotesk-Medium.ttf",
        "SpaceGrotesk-Bold.ttf",
        "DMMono-Regular.ttf",
        "DMMono-Medium.ttf",
    ]

    static func sansFontName(for weight: Font.Weight) -> String {
        switch weight {
        case .medium:
            return "SpaceGrotesk-Medium"
        case .semibold, .bold, .heavy, .black:
            return "SpaceGrotesk-Bold"
        default:
            return "SpaceGrotesk-Regular"
        }
    }

    static func monoFontName(for weight: Font.Weight) -> String {
        switch weight {
        case .medium, .semibold, .bold, .heavy, .black:
            return "DMMono-Medium"
        default:
            return "DMMono-Regular"
        }
    }

    static func sans(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo textStyle: Font.TextStyle = .body
    ) -> Font {
        .custom(sansFontName(for: weight), size: size, relativeTo: textStyle)
    }

    static func mono(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo textStyle: Font.TextStyle = .caption
    ) -> Font {
        .custom(monoFontName(for: weight), size: size, relativeTo: textStyle)
    }
}

extension Font {
    static func cowtailSans(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo textStyle: Font.TextStyle = .body
    ) -> Font {
        CowtailTypography.sans(size, weight: weight, relativeTo: textStyle)
    }

    static func cowtailMono(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo textStyle: Font.TextStyle = .caption
    ) -> Font {
        CowtailTypography.mono(size, weight: weight, relativeTo: textStyle)
    }
}
