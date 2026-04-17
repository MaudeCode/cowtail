import XCTest
@testable import Cowtail

final class CowtailDesignGuideTests: XCTestCase {
    func testAccentRedMatchesApprovedCowtailShell() {
        let palette = ThemeCatalog.definition(for: .cowtail).darkPalette
        XCTAssertEqual(palette.accentHex, "#B8242C")
    }

    func testPrimaryMetricsUseTwoColumnStripOnPhone() {
        XCTAssertEqual(CowtailDesignGuide.primaryMetricColumns, 2)
    }

    func testGridTextureIsSubtle() {
        XCTAssertLessThanOrEqual(CowtailDesignGuide.gridOpacity, 0.02)
    }

    func testCardCornerRadiusMatchesApprovedShell() {
        XCTAssertEqual(CowtailDesignGuide.cardCornerRadius, 22)
    }

    func testPageHeaderFontSizeMatchesApprovedShell() {
        XCTAssertEqual(CowtailDesignGuide.pageHeaderFontSize, 30)
    }
}
