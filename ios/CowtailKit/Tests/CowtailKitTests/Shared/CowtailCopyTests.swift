import XCTest
@testable import CowtailKit

final class CowtailCopyTests: XCTestCase {
    func testRoundupLabelUsesUpdatedVisibleCopy() {
        XCTAssertEqual(CowtailCopy.roundupTitle, "Roundup")
        XCTAssertEqual(CowtailCopy.roundupBrandLeading, "ROUND")
        XCTAssertEqual(CowtailCopy.roundupBrandTrailing, "UP")
    }

    func testRoundupInvalidRangeMessageUsesRoundupTerminology() {
        XCTAssertEqual(CowtailCopy.roundupInvalidRangeMessage, "This roundup range is invalid.")
    }
}
