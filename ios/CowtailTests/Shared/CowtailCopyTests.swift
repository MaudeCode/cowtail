import XCTest
@testable import Cowtail

final class CowtailCopyTests: XCTestCase {
    func testRoundupLabelReplacesDigestInVisibleCopy() {
        XCTAssertEqual(CowtailCopy.farmhouseTitle, "Farmhouse")
        XCTAssertEqual(CowtailCopy.farmhouseBrandLeading, "FARM")
        XCTAssertEqual(CowtailCopy.farmhouseBrandTrailing, "HOUSE")
        XCTAssertEqual(CowtailCopy.roundupTitle, "Roundup")
        XCTAssertEqual(CowtailCopy.roundupBrandLeading, "ROUND")
        XCTAssertEqual(CowtailCopy.roundupBrandTrailing, "UP")
        XCTAssertEqual(CowtailCopy.dailyRoundupTitle, "Daily Roundup")
    }
}
