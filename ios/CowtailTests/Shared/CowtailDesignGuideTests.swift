import XCTest
@testable import Cowtail

final class CowtailDesignGuideTests: XCTestCase {
    func testPrimaryMetricsUseTwoColumnStripOnPhone() {
        XCTAssertEqual(CowtailDesignGuide.primaryMetricColumns, 2)
    }

    func testGridTextureIsSubtle() {
        XCTAssertLessThanOrEqual(CowtailDesignGuide.gridOpacity, 0.02)
    }

    func testCardCornerRadiusMatchesApprovedShell() {
        XCTAssertEqual(CowtailDesignGuide.cardCornerRadius, 22)
    }
}
