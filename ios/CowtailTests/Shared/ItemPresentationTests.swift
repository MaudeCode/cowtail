import XCTest
@testable import Cowtail

final class ItemPresentationTests: XCTestCase {
    func testANotifiedEventNamesTheDecisionTheServerRecorded() {
        let text = { (payload: [String: String]) in
            ItemEvent(id: "event", at: .now, type: .notified, actor: "cowtail", payload: payload).text
        }

        XCTAssertEqual(text(["decision": "pushed"]), "Push sent")
        XCTAssertEqual(text(["decision": "skipped", "why": "not_open"]), "Skipped · not open")
        XCTAssertEqual(text(["decision": "held", "why": "quiet_hours"]), "Held · quiet hours")
        XCTAssertEqual(text(["decision": "batched"]), "Batched")
    }
}
