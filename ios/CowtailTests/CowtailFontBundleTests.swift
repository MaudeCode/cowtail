import UIKit
import XCTest
@testable import Cowtail

/// Needs the app host: it reads the fonts the installed app registers. CI runs it in the `ios-sim` suite.
final class CowtailFontBundleTests: XCTestCase {
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
