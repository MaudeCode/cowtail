import XCTest
@testable import CowtailKit

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
}
