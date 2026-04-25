import XCTest
@testable import Cowtail

final class OpenClawRealtimeClientTests: XCTestCase {
    func testHelloPayloadIsTextJSONAndIncludesSessionAndReplayCursor() throws {
        let payload = try OpenClawRealtimeClient.makeHelloPayload(
            sessionToken: "session-token",
            lastSeenSequence: 42
        )
        let data = try XCTUnwrap(payload.data(using: .utf8))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["protocolVersion"] as? Int, 1)
        XCTAssertEqual(object["clientKind"] as? String, "ios")
        XCTAssertEqual(object["appSessionToken"] as? String, "session-token")
        XCTAssertEqual(object["lastSeenSequence"] as? Int, 42)
    }

    func testReconnectDelaysAreBounded() {
        XCTAssertEqual(OpenClawRealtimeClient.reconnectDelay(attempt: 0), .milliseconds(500))
        XCTAssertEqual(OpenClawRealtimeClient.reconnectDelay(attempt: 4), .seconds(10))
        XCTAssertEqual(OpenClawRealtimeClient.reconnectDelay(attempt: 20), .seconds(10))
    }
}
