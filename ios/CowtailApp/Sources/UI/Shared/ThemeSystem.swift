import SwiftUI

enum ThemeAppearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system:
            return "System"
        case .light:
            return "Light"
        case .dark:
            return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system:
            return nil
        case .light:
            return .light
        case .dark:
            return .dark
        }
    }
}

enum ThemeStyle: String, CaseIterable, Identifiable {
    case cowtail
    case graphite

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cowtail:
            return "Cowtail"
        case .graphite:
            return "Graphite"
        }
    }
}

struct ThemePalette {
    let canvas: Color
    let card: Color
    let cardBorder: Color
    let ink: Color
    let accent: Color
    let accentSoft: Color
    let moss: Color
    let storm: Color
    let heroGradient: LinearGradient
    let secondaryHeroGradient: LinearGradient
}

struct ThemeDefinition {
    let style: ThemeStyle
    let title: String
    let lightPalette: ThemePalette
    let darkPalette: ThemePalette

    func palette(for colorScheme: ColorScheme) -> ThemePalette {
        colorScheme == .dark ? darkPalette : lightPalette
    }
}

enum ThemeCatalog {
    static func definition(for style: ThemeStyle) -> ThemeDefinition {
        switch style {
        case .cowtail:
            return ThemeDefinition(
                style: .cowtail,
                title: "Cowtail",
                lightPalette: ThemePalette(
                    canvas: Color(red: 0.95, green: 0.94, blue: 0.92),
                    card: Color.white.opacity(0.92),
                    cardBorder: Color(red: 0.71, green: 0.66, blue: 0.60).opacity(0.22),
                    ink: Color(red: 0.13, green: 0.13, blue: 0.15),
                    accent: Color(red: 0.76, green: 0.34, blue: 0.19),
                    accentSoft: Color(red: 0.91, green: 0.73, blue: 0.60),
                    moss: Color(red: 0.30, green: 0.55, blue: 0.40),
                    storm: Color(red: 0.25, green: 0.31, blue: 0.38),
                    heroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.55, green: 0.30, blue: 0.20),
                            Color(red: 0.25, green: 0.29, blue: 0.34)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    secondaryHeroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.40, green: 0.48, blue: 0.36),
                            Color(red: 0.19, green: 0.24, blue: 0.29)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                ),
                darkPalette: ThemePalette(
                    canvas: Color(red: 0.05, green: 0.06, blue: 0.09),
                    card: Color(red: 0.10, green: 0.12, blue: 0.16).opacity(0.96),
                    cardBorder: Color.white.opacity(0.08),
                    ink: Color(red: 0.93, green: 0.95, blue: 0.98),
                    accent: Color(red: 0.95, green: 0.44, blue: 0.24),
                    accentSoft: Color(red: 0.32, green: 0.18, blue: 0.15),
                    moss: Color(red: 0.40, green: 0.75, blue: 0.56),
                    storm: Color(red: 0.72, green: 0.77, blue: 0.85),
                    heroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.19, green: 0.12, blue: 0.12),
                            Color(red: 0.08, green: 0.10, blue: 0.15)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    secondaryHeroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.09, green: 0.14, blue: 0.18),
                            Color(red: 0.06, green: 0.08, blue: 0.12)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            )
        case .graphite:
            return ThemeDefinition(
                style: .graphite,
                title: "Graphite",
                lightPalette: ThemePalette(
                    canvas: Color(red: 0.95, green: 0.96, blue: 0.98),
                    card: Color.white.opacity(0.94),
                    cardBorder: Color.black.opacity(0.08),
                    ink: Color(red: 0.10, green: 0.12, blue: 0.15),
                    accent: Color(red: 0.29, green: 0.50, blue: 0.88),
                    accentSoft: Color(red: 0.80, green: 0.86, blue: 0.98),
                    moss: Color(red: 0.25, green: 0.65, blue: 0.53),
                    storm: Color(red: 0.22, green: 0.28, blue: 0.36),
                    heroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.34, green: 0.42, blue: 0.55),
                            Color(red: 0.20, green: 0.25, blue: 0.33)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    secondaryHeroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.49, green: 0.54, blue: 0.61),
                            Color(red: 0.25, green: 0.28, blue: 0.34)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                ),
                darkPalette: ThemePalette(
                    canvas: Color(red: 0.04, green: 0.05, blue: 0.07),
                    card: Color(red: 0.09, green: 0.11, blue: 0.14).opacity(0.98),
                    cardBorder: Color.white.opacity(0.07),
                    ink: Color(red: 0.92, green: 0.94, blue: 0.98),
                    accent: Color(red: 0.44, green: 0.62, blue: 0.98),
                    accentSoft: Color(red: 0.13, green: 0.17, blue: 0.25),
                    moss: Color(red: 0.34, green: 0.78, blue: 0.63),
                    storm: Color(red: 0.71, green: 0.76, blue: 0.84),
                    heroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.15, green: 0.18, blue: 0.26),
                            Color(red: 0.08, green: 0.10, blue: 0.14)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    secondaryHeroGradient: LinearGradient(
                        colors: [
                            Color(red: 0.18, green: 0.22, blue: 0.28),
                            Color(red: 0.08, green: 0.09, blue: 0.12)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            )
        }
    }
}

@MainActor
final class ThemeSettings: ObservableObject {
    @Published var appearancePreference: ThemeAppearance {
        didSet {
            defaults.set(appearancePreference.rawValue, forKey: appearancePreferenceKey)
        }
    }

    @Published var themeStyle: ThemeStyle {
        didSet {
            defaults.set(themeStyle.rawValue, forKey: themeStyleKey)
        }
    }

    private let defaults: UserDefaults
    private let appearancePreferenceKey = "themeAppearancePreference"
    private let themeStyleKey = "themeStylePreference"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.appearancePreference = ThemeAppearance(rawValue: defaults.string(forKey: appearancePreferenceKey) ?? "") ?? .system
        self.themeStyle = ThemeStyle(rawValue: defaults.string(forKey: themeStyleKey) ?? "") ?? .cowtail
    }

    func palette(for colorScheme: ColorScheme) -> ThemePalette {
        ThemeCatalog.definition(for: themeStyle).palette(for: colorScheme)
    }
}

private struct CowtailPaletteKey: EnvironmentKey {
    static let defaultValue = ThemeCatalog.definition(for: .cowtail).darkPalette
}

extension EnvironmentValues {
    var cowtailPalette: ThemePalette {
        get { self[CowtailPaletteKey.self] }
        set { self[CowtailPaletteKey.self] = newValue }
    }
}

struct ThemedRoot<Content: View>: View {
    @EnvironmentObject private var themeSettings: ThemeSettings
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .environment(\.cowtailPalette, themeSettings.palette(for: colorScheme))
    }
}
