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
    let surface: Color
    let surfaceRaised: Color
    let border: Color
    let ink: Color
    let mutedInk: Color
    let accent: Color
    let accentSoft: Color
    let success: Color
    let warning: Color
    let info: Color
    let gridLine: Color
    let accentHex: String

    var card: Color { surface }
    var cardBorder: Color { border }
    var moss: Color { success }
    var storm: Color { mutedInk }
    var heroGradient: LinearGradient {
        LinearGradient(
            colors: [surfaceRaised, surface],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    var secondaryHeroGradient: LinearGradient {
        LinearGradient(
            colors: [surface, canvas],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
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
                    surface: Color.white.opacity(0.94),
                    surfaceRaised: Color.white,
                    border: Color(red: 0.71, green: 0.66, blue: 0.60).opacity(0.18),
                    ink: Color(red: 0.13, green: 0.13, blue: 0.15),
                    mutedInk: Color(red: 0.39, green: 0.39, blue: 0.44),
                    accent: Color(red: 0.72, green: 0.14, blue: 0.17),
                    accentSoft: Color(red: 0.72, green: 0.14, blue: 0.17).opacity(0.08),
                    success: Color(red: 0.18, green: 0.61, blue: 0.32),
                    warning: Color(red: 0.83, green: 0.53, blue: 0.04),
                    info: Color(red: 0.23, green: 0.48, blue: 0.84),
                    gridLine: Color.black.opacity(CowtailDesignGuide.gridOpacity * 0.75),
                    accentHex: "#B8242C"
                ),
                darkPalette: ThemePalette(
                    canvas: Color(red: 0.055, green: 0.055, blue: 0.063),
                    surface: Color(red: 0.086, green: 0.086, blue: 0.094).opacity(0.92),
                    surfaceRaised: Color(red: 0.11, green: 0.11, blue: 0.12).opacity(0.96),
                    border: Color.white.opacity(0.08),
                    ink: Color(red: 0.91, green: 0.91, blue: 0.92),
                    mutedInk: Color(red: 0.55, green: 0.55, blue: 0.59),
                    accent: Color(red: 0.72, green: 0.14, blue: 0.17),
                    accentSoft: Color(red: 0.72, green: 0.14, blue: 0.17).opacity(0.08),
                    success: Color(red: 0.18, green: 0.61, blue: 0.32),
                    warning: Color(red: 0.83, green: 0.53, blue: 0.04),
                    info: Color(red: 0.23, green: 0.48, blue: 0.84),
                    gridLine: Color.white.opacity(CowtailDesignGuide.gridOpacity),
                    accentHex: "#B8242C"
                )
            )
        case .graphite:
            return ThemeDefinition(
                style: .graphite,
                title: "Graphite",
                lightPalette: ThemePalette(
                    canvas: Color(red: 0.95, green: 0.96, blue: 0.98),
                    surface: Color.white.opacity(0.94),
                    surfaceRaised: Color.white,
                    border: Color.black.opacity(0.08),
                    ink: Color(red: 0.10, green: 0.12, blue: 0.15),
                    mutedInk: Color(red: 0.32, green: 0.36, blue: 0.42),
                    accent: Color(red: 0.29, green: 0.50, blue: 0.88),
                    accentSoft: Color(red: 0.80, green: 0.86, blue: 0.98).opacity(0.12),
                    success: Color(red: 0.25, green: 0.65, blue: 0.53),
                    warning: Color(red: 0.82, green: 0.57, blue: 0.15),
                    info: Color(red: 0.29, green: 0.50, blue: 0.88),
                    gridLine: Color.black.opacity(CowtailDesignGuide.gridOpacity * 0.75),
                    accentHex: "#4A80E0"
                ),
                darkPalette: ThemePalette(
                    canvas: Color(red: 0.04, green: 0.05, blue: 0.07),
                    surface: Color(red: 0.09, green: 0.11, blue: 0.14).opacity(0.98),
                    surfaceRaised: Color(red: 0.13, green: 0.16, blue: 0.20).opacity(0.98),
                    border: Color.white.opacity(0.07),
                    ink: Color(red: 0.92, green: 0.94, blue: 0.98),
                    mutedInk: Color(red: 0.71, green: 0.76, blue: 0.84),
                    accent: Color(red: 0.44, green: 0.62, blue: 0.98),
                    accentSoft: Color(red: 0.13, green: 0.17, blue: 0.25).opacity(0.18),
                    success: Color(red: 0.34, green: 0.78, blue: 0.63),
                    warning: Color(red: 0.84, green: 0.63, blue: 0.18),
                    info: Color(red: 0.44, green: 0.62, blue: 0.98),
                    gridLine: Color.white.opacity(CowtailDesignGuide.gridOpacity),
                    accentHex: "#709EFF"
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
