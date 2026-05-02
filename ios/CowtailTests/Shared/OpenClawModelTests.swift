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
        let reply = OpenClawClientCommand.reply(
            .init(requestId: "request-1", threadId: "thread-1", text: "Ship it")
        )

        let replyObject = try JSONSerialization.jsonObject(with: encoder.encode(reply)) as? [String: Any]
        XCTAssertEqual(replyObject?["type"] as? String, "ios_reply")
        XCTAssertEqual(reply.requestId, "request-1")
        XCTAssertEqual(replyObject?["requestId"] as? String, "request-1")
        XCTAssertEqual(replyObject?["threadId"] as? String, "thread-1")
        XCTAssertEqual(replyObject?["text"] as? String, "Ship it")

        let rename = OpenClawClientCommand.renameThread(
            .init(requestId: "request-2", threadId: "thread-1", title: "Better title")
        )
        let renameObject = try JSONSerialization.jsonObject(with: encoder.encode(rename)) as? [String: Any]
        XCTAssertEqual(renameObject?["type"] as? String, "ios_rename_thread")
        XCTAssertEqual(rename.requestId, "request-2")
        XCTAssertEqual(renameObject?["requestId"] as? String, "request-2")
        XCTAssertEqual(renameObject?["threadId"] as? String, "thread-1")
        XCTAssertEqual(renameObject?["title"] as? String, "Better title")

        let delete = OpenClawClientCommand.deleteThread(
            .init(requestId: "request-3", threadId: "thread-1")
        )
        let deleteObject = try JSONSerialization.jsonObject(with: encoder.encode(delete)) as? [String: Any]
        XCTAssertEqual(deleteObject?["type"] as? String, "ios_delete_thread")
        XCTAssertEqual(delete.requestId, "request-3")
        XCTAssertEqual(deleteObject?["requestId"] as? String, "request-3")
        XCTAssertEqual(deleteObject?["threadId"] as? String, "thread-1")
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

    func testDecodesToolCallsOnMessages() throws {
        let decoder = JSONDecoder()
        let event = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        {
          "sequence": 4,
          "type": "message_updated",
          "createdAt": 1777128000000,
          "threadId": "thread-1",
          "messageId": "message-1",
          "message": {
            "id": "message-1",
            "threadId": "thread-1",
            "direction": "openclaw_to_user",
            "authorLabel": "OpenClaw",
            "text": "Checking logs.",
            "links": [],
            "toolCalls": [{
              "id": "preview-tool",
              "name": "read_file",
              "args": { "path": "/var/log/app.log" },
              "result": "deployment complete",
              "status": "complete",
              "startedAt": 1777127999000,
              "completedAt": 1777128000000,
              "insertedAtContentLength": 9,
              "contentSnapshotAtStart": "Checking "
            }],
            "deliveryState": "sent",
            "createdAt": 1777127999000,
            "updatedAt": 1777128000000
          }
        }
        """.utf8))

        guard case .event(let envelope) = event else {
            return XCTFail("Expected event")
        }

        let toolCall = try XCTUnwrap(envelope.message?.toolCalls.first)
        XCTAssertEqual(toolCall.id, "preview-tool")
        XCTAssertEqual(toolCall.name, "read_file")
        XCTAssertEqual(toolCall.status, .complete)
        XCTAssertEqual(toolCall.insertedAtContentLength, 9)
        XCTAssertEqual(toolCall.args?["path"], .string("/var/log/app.log"))
        XCTAssertEqual(toolCall.result, .string("deployment complete"))
    }

    func testPreviewMessageFixturesPreserveToolCalls() throws {
        let toolCall = try XCTUnwrap(CowtailPreviewFixtures.openClawMessageWithActions.toolCalls.first)

        XCTAssertEqual(toolCall.id, "preview-tool")
        XCTAssertEqual(toolCall.name, "query_metrics")
    }
}
