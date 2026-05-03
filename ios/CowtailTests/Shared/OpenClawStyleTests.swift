import XCTest
@testable import Cowtail

final class OpenClawStyleTests: XCTestCase {
    func testOpenClawStyleUsesCurrentPaletteAccent() {
        let palette = ThemeCatalog.definition(for: .cowtail).darkPalette
        let style = OpenClawStyle(palette: palette)

        XCTAssertEqual(style.accentHex, palette.accentHex)
    }

    func testOpenClawStyleUsesFloatingChatRadii() {
        let palette = ThemeCatalog.definition(for: .cowtail).darkPalette
        let style = OpenClawStyle(palette: palette)

        XCTAssertGreaterThan(style.toolCornerRadius, CowtailDesignGuide.cardCornerRadius)
        XCTAssertGreaterThan(style.composerCornerRadius, CowtailDesignGuide.cardCornerRadius)
    }

    func testOpenClawStylePinsTranscriptTokenSizes() {
        let palette = ThemeCatalog.definition(for: .cowtail).darkPalette
        let style = OpenClawStyle(palette: palette)

        XCTAssertEqual(style.transcriptSpacing, 30)
        XCTAssertEqual(style.transcriptHorizontalPadding, 16)
        XCTAssertEqual(style.toolCornerRadius, 28)
        XCTAssertEqual(style.toolNameCornerRadius, 7)
        XCTAssertEqual(style.composerCornerRadius, 28)
        XCTAssertEqual(style.controlCornerRadius, 18)
    }

    func testOpenClawStyleKeepsTranscriptColorsThemeDerived() {
        let palette = ThemeCatalog.definition(for: .cowtail).darkPalette
        let style = OpenClawStyle(palette: palette)

        XCTAssertEqual(style.canvas, palette.canvas)
        XCTAssertEqual(style.primaryText, palette.ink)
        XCTAssertEqual(style.secondaryText, palette.mutedInk)
    }

    func testOpenClawStyleHasThemeDerivedFloatingSurfaces() {
        let palette = ThemeCatalog.definition(for: .cowtail).darkPalette
        let style = OpenClawStyle(palette: palette)

        XCTAssertEqual(style.composerSurface, palette.surfaceRaised.opacity(0.94))
        XCTAssertEqual(style.floatingChromeSurface, palette.surfaceRaised.opacity(0.88))
        XCTAssertEqual(style.codeBlockSurface, palette.surfaceRaised.opacity(0.98))
    }
}
