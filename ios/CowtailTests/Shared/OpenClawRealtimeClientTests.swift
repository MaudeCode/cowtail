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

    func testDecodeServerMessageDataParsesRealtimeEvents() async throws {
        let json = """
        {
          "sequence": 7,
          "type": "hello_acknowledged",
          "createdAt": 1777128000000,
          "threadId": null,
          "messageId": null,
          "thread": null,
          "message": null,
          "actions": [],
          "payload": null,
          "error": null
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))

        let message = try await OpenClawRealtimeClient.decodeServerMessageData(data)

        guard case .event(let event) = message else {
            return XCTFail("Expected event")
        }
        XCTAssertEqual(event.type, "hello_acknowledged")
        XCTAssertEqual(event.sequence, 7)
    }
}
