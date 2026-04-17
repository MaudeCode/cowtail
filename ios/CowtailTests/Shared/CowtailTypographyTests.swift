import XCTest
@testable import Cowtail
import UIKit

final class CowtailTypographyTests: XCTestCase {
    func testBrandSansFontFacesMatchApprovedSpaceGroteskWeights() {
        XCTAssertEqual(CowtailTypography.sansFontName(for: .regular), "SpaceGrotesk-Regular")
        XCTAssertEqual(CowtailTypography.sansFontName(for: .medium), "SpaceGrotesk-Medium")
        XCTAssertEqual(CowtailTypography.sansFontName(for: .semibold), "SpaceGrotesk-Bold")
        XCTAssertEqual(CowtailTypography.sansFontName(for: .bold), "SpaceGrotesk-Bold")
    }

    func testBundledFontFilesMatchApprovedCowtailTypographyAssets() {
        XCTAssertEqual(
            CowtailTypography.bundledFontFiles,
            [
                "SpaceGrotesk-Regular.ttf",
                "SpaceGrotesk-Medium.ttf",
                "SpaceGrotesk-Bold.ttf",
                "DMMono-Regular.ttf",
                "DMMono-Medium.ttf",
            ]
        )
    }

    func testAppBundleRegistersCowtailFontFiles() {
        let infoFonts = Bundle.main.object(forInfoDictionaryKey: "UIAppFonts") as? [String]
        XCTAssertEqual(infoFonts, CowtailTypography.bundledFontFiles)
    }

    func testRegisteredCowtailFontsCanBeInstantiated() {
        XCTAssertNotNil(UIFont(name: CowtailTypography.sansFontName(for: .regular), size: 16))
        XCTAssertNotNil(UIFont(name: CowtailTypography.sansFontName(for: .bold), size: 16))
        XCTAssertNotNil(UIFont(name: CowtailTypography.monoFontName(for: .regular), size: 12))
        XCTAssertNotNil(UIFont(name: CowtailTypography.monoFontName(for: .medium), size: 12))
    }
}
