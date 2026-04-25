import XCTest
@testable import Cowtail

final class OpenClawModelTests: XCTestCase {
    func testDecodesThreadMessageActionAndEvent() throws {
        let decoder = JSONDecoder()
        let event = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        {
          "sequence": 3,
          "type": "message_created",
          "createdAt": 1777128000000,
          "threadId": "thread-1",
          "messageId": "message-1",
          "thread": {
            "id": "thread-1",
            "sessionKey": "cowtail:thread-1",
            "status": "active",
            "targetAgent": "default",
            "title": "Deploy check",
            "unreadCount": 1,
            "createdAt": 1777127000000,
            "updatedAt": 1777128000000,
            "lastMessageAt": 1777128000000
          },
          "message": {
            "id": "message-1",
            "threadId": "thread-1",
            "direction": "openclaw_to_user",
            "authorLabel": "OpenClaw",
            "text": "Approve rollout?",
            "links": [],
            "deliveryState": "sent",
            "createdAt": 1777128000000,
            "updatedAt": 1777128000000
          },
          "actions": [{
            "id": "action-1",
            "threadId": "thread-1",
            "messageId": "message-1",
            "label": "Approve",
            "kind": "decision",
            "payload": { "decision": "approve" },
            "state": "pending",
            "createdAt": 1777128000001,
            "updatedAt": 1777128000001
          }]
        }
        """.utf8))

        guard case .event(let envelope) = event else {
            return XCTFail("Expected event")
        }

        XCTAssertEqual(envelope.sequence, 3)
        XCTAssertEqual(envelope.thread?.title, "Deploy check")
        XCTAssertEqual(envelope.actions.first?.label, "Approve")
    }

    func testEncodesIosCommands() throws {
        let encoder = JSONEncoder()
        let command = OpenClawClientCommand.reply(
            .init(requestId: "request-1", threadId: "thread-1", text: "Ship it")
        )

        let object = try JSONSerialization.jsonObject(with: encoder.encode(command)) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "ios_reply")
        XCTAssertEqual(object?["threadId"] as? String, "thread-1")
        XCTAssertEqual(object?["text"] as? String, "Ship it")
    }

    func testDecodesAckAndRealtimeError() throws {
        let decoder = JSONDecoder()
        let ack = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        { "type": "ack", "requestId": "request-1", "sequence": 9 }
        """.utf8))
        let error = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        { "type": "realtime_error", "requestId": "request-2", "error": "Nope" }
        """.utf8))

        if case .ack(let value) = ack {
            XCTAssertEqual(value.sequence, 9)
        } else {
            XCTFail("Expected ack")
        }

        if case .realtimeError(let value) = error {
            XCTAssertEqual(value.error, "Nope")
        } else {
            XCTFail("Expected realtime error")
        }
    }
}
