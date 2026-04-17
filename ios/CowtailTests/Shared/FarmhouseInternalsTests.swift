import XCTest
@testable import Cowtail

final class FarmhouseInternalsTests: XCTestCase {
    func testFarmhouseUsesRenamedInternalTypes() {
        let tab: AppTab = .farmhouse
        XCTAssertEqual(tab, .farmhouse)

        _ = FarmhouseView.self
    }
}
