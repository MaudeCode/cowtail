import SwiftUI

struct OpenClawStyle {
    let palette: ThemePalette

    var canvas: Color { palette.canvas }
    var chrome: Color { palette.surfaceRaised }
    var surface: Color { palette.surface }
    var elevatedSurface: Color { palette.surfaceRaised }
    var border: Color { palette.border }
    var primaryText: Color { palette.ink }
    var secondaryText: Color { palette.mutedInk }
    var accent: Color { palette.accent }
    var accentSoft: Color { palette.accentSoft }
    var success: Color { palette.success }
    var warning: Color { palette.warning }
    var info: Color { palette.info }
    var accentHex: String { palette.accentHex }
    var transcriptSecondarySurface: Color { palette.surfaceRaised.opacity(0.78) }
    var transcriptHoverSurface: Color { palette.surfaceRaised.opacity(0.48) }
    var composerSurface: Color { palette.surfaceRaised.opacity(0.94) }
    var floatingChromeSurface: Color { palette.surfaceRaised.opacity(0.88) }
    var codeBlockSurface: Color { palette.surfaceRaised.opacity(0.98) }

    let toolCornerRadius: CGFloat = 28
    let composerCornerRadius: CGFloat = 28
    let controlCornerRadius: CGFloat = 18
    let avatarSize: CGFloat = 26
    let transcriptSpacing: CGFloat = 30
    let transcriptHorizontalPadding: CGFloat = 16
    let transcriptHeaderVerticalPadding: CGFloat = 10
    let toolNameCornerRadius: CGFloat = 7
    let sendButtonSize: CGFloat = 36
    let sendTapTargetSize: CGFloat = 44
}

private struct OpenClawStyleKey: EnvironmentKey {
    static let defaultValue = OpenClawStyle(palette: ThemeCatalog.definition(for: .cowtail).darkPalette)
}

extension EnvironmentValues {
    var openClawStyle: OpenClawStyle {
        get { self[OpenClawStyleKey.self] }
        set { self[OpenClawStyleKey.self] = newValue }
    }
}

extension View {
    func openClawStyle(_ style: OpenClawStyle) -> some View {
        environment(\.openClawStyle, style)
    }
}
