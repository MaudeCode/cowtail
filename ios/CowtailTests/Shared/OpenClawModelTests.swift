import XCTest
@testable import Cowtail

final class OpenClawModelTests: XCTestCase {
    func testAssistantRenderBlocksPlaceToolBeforeFinalTextWhenToolStartsAtEmptyContent() {
        let toolCall = makeToolCall(
            id: "tool-first",
            insertedAtContentLength: 0,
            contentSnapshotAtStart: ""
        )
        let message = makeMessage(
            text: "Final summary after the tool.",
            direction: .openClawToUser,
            toolCalls: [toolCall]
        )

        XCTAssertEqual(
            OpenClawMessageRenderPlan.blocks(for: message),
            [
                .tool(toolCall),
                .text("Final summary after the tool.")
            ]
        )
    }

    func testAssistantRenderBlocksSplitTextAroundToolWhenMetadataMatchesPrefix() {
        let toolCall = makeToolCall(
            id: "middle-tool",
            insertedAtContentLength: 9,
            contentSnapshotAtStart: "Checking "
        )
        let message = makeMessage(
            text: "Checking logs now.",
            direction: .openClawToUser,
            toolCalls: [toolCall]
        )

        XCTAssertEqual(
            OpenClawMessageRenderPlan.blocks(for: message),
            [
                .text("Checking "),
                .tool(toolCall),
                .text("logs now.")
            ]
        )
    }

    func testAssistantRenderBlocksFallBackToTextBeforeToolsWhenMetadataIsMissing() {
        let toolCall = makeToolCall(
            id: "missing-metadata",
            insertedAtContentLength: nil,
            contentSnapshotAtStart: nil
        )
        let message = makeMessage(
            text: "Final text.",
            direction: .openClawToUser,
            toolCalls: [toolCall]
        )

        XCTAssertEqual(
            OpenClawMessageRenderPlan.blocks(for: message),
            [
                .text("Final text."),
                .tool(toolCall)
            ]
        )
    }

    func testAssistantRenderBlocksFallBackToTextBeforeToolsWhenMetadataIsInconsistent() {
        let toolCall = makeToolCall(
            id: "bad-metadata",
            insertedAtContentLength: 8,
            contentSnapshotAtStart: "Checking "
        )
        let message = makeMessage(
            text: "Checking logs now.",
            direction: .openClawToUser,
            toolCalls: [toolCall]
        )

        XCTAssertEqual(
            OpenClawMessageRenderPlan.blocks(for: message),
            [
                .text("Checking logs now."),
                .tool(toolCall)
            ]
        )
    }

    func testUserRenderBlocksPreserveExistingTextBeforeToolsBehavior() {
        let toolCall = makeToolCall(
            id: "user-tool",
            insertedAtContentLength: 0,
            contentSnapshotAtStart: ""
        )
        let message = makeMessage(
            text: "User text.",
            direction: .userToOpenClaw,
            toolCalls: [toolCall]
        )

        XCTAssertEqual(
            OpenClawMessageRenderPlan.blocks(for: message),
            [
                .text("User text."),
                .tool(toolCall)
            ]
        )
    }

    func testAssistantRenderBlockIdentitiesStayUniqueWhenTextRepeatsAroundTools() {
        let firstTool = makeToolCall(
            id: "first-tool",
            insertedAtContentLength: 4,
            contentSnapshotAtStart: "same"
        )
        let secondTool = makeToolCall(
            id: "second-tool",
            insertedAtContentLength: 12,
            contentSnapshotAtStart: "same middle "
        )
        let message = makeMessage(
            text: "same middle same",
            direction: .openClawToUser,
            toolCalls: [firstTool, secondTool]
        )

        let blocks = OpenClawMessageRenderPlan.identifiedBlocks(for: message)

        XCTAssertEqual(
            blocks.map(\.content),
            [
                .text("same"),
                .tool(firstTool),
                .text(" middle "),
                .tool(secondTool),
                .text("same")
            ]
        )
        XCTAssertEqual(Set(blocks.map(\.id)).count, blocks.count)
    }

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
            .init(requestId: "request-1", idempotencyKey: "ios:reply:request-1", threadId: "thread-1", text: "Ship it")
        )

        let replyObject = try JSONSerialization.jsonObject(with: encoder.encode(reply)) as? [String: Any]
        XCTAssertEqual(replyObject?["type"] as? String, "ios_reply")
        XCTAssertEqual(reply.requestId, "request-1")
        XCTAssertEqual(replyObject?["requestId"] as? String, "request-1")
        XCTAssertEqual(replyObject?["idempotencyKey"] as? String, "ios:reply:request-1")
        XCTAssertEqual(replyObject?["threadId"] as? String, "thread-1")
        XCTAssertEqual(replyObject?["text"] as? String, "Ship it")

        let rename = OpenClawClientCommand.renameThread(
            .init(requestId: "request-2", idempotencyKey: "ios:rename:request-2", threadId: "thread-1", title: "Better title")
        )
        let renameObject = try JSONSerialization.jsonObject(with: encoder.encode(rename)) as? [String: Any]
        XCTAssertEqual(renameObject?["type"] as? String, "ios_rename_thread")
        XCTAssertEqual(rename.requestId, "request-2")
        XCTAssertEqual(renameObject?["requestId"] as? String, "request-2")
        XCTAssertEqual(renameObject?["idempotencyKey"] as? String, "ios:rename:request-2")
        XCTAssertEqual(renameObject?["threadId"] as? String, "thread-1")
        XCTAssertEqual(renameObject?["title"] as? String, "Better title")

        let delete = OpenClawClientCommand.deleteThread(
            .init(requestId: "request-3", idempotencyKey: "ios:delete:request-3", threadId: "thread-1")
        )
        let deleteObject = try JSONSerialization.jsonObject(with: encoder.encode(delete)) as? [String: Any]
        XCTAssertEqual(deleteObject?["type"] as? String, "ios_delete_thread")
        XCTAssertEqual(delete.requestId, "request-3")
        XCTAssertEqual(deleteObject?["requestId"] as? String, "request-3")
        XCTAssertEqual(deleteObject?["idempotencyKey"] as? String, "ios:delete:request-3")
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

    func testDecodesStreamSnapshotWithRunningToolCall() throws {
        let decoder = JSONDecoder()
        let message = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        {
          "type": "openclaw_message_stream_snapshot",
          "streamId": "stream-message-1",
          "sessionKey": "session-1",
          "threadId": "thread-1",
          "text": "Checking logs.",
          "links": [{
            "label": "Runbook",
            "url": "https://example.invalid/runbook"
          }],
          "toolCalls": [{
            "id": "call-read",
            "name": "read_file",
            "args": { "path": "/var/log/app.log" },
            "status": "running",
            "startedAt": 1777127999000,
            "insertedAtContentLength": 9,
            "contentSnapshotAtStart": "Checking "
          }],
          "isFinal": false,
          "snapshotSequence": 4,
          "updatedAt": 1777128000000
        }
        """.utf8))

        let expectedSnapshot = OpenClawStreamSnapshot(
            type: "openclaw_message_stream_snapshot",
            streamId: "stream-message-1",
            sessionKey: "session-1",
            threadId: "thread-1",
            text: "Checking logs.",
            links: [.init(label: "Runbook", url: "https://example.invalid/runbook")],
            toolCalls: [
                OpenClawToolCall(
                    id: "call-read",
                    name: "read_file",
                    args: ["path": .string("/var/log/app.log")],
                    result: nil,
                    status: .running,
                    startedAt: 1777127999000,
                    completedAt: nil,
                    insertedAtContentLength: 9,
                    contentSnapshotAtStart: "Checking "
                )
            ],
            isFinal: false,
            snapshotSequence: 4,
            updatedAt: 1777128000000
        )

        XCTAssertEqual(message, .streamSnapshot(expectedSnapshot))
    }

    func testDecodesStreamSnapshotWithOmittedArrayFields() throws {
        let decoder = JSONDecoder()
        let message = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        {
          "type": "openclaw_message_stream_snapshot",
          "streamId": "stream-message-1",
          "sessionKey": "session-1",
          "threadId": "thread-1",
          "text": "Checking logs.",
          "isFinal": false,
          "snapshotSequence": 1,
          "updatedAt": 1777128000000
        }
        """.utf8))

        guard case .streamSnapshot(let snapshot) = message else {
            return XCTFail("Expected stream snapshot")
        }

        XCTAssertEqual(snapshot.links, [])
        XCTAssertEqual(snapshot.toolCalls, [])
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

    func testDecodesToolOnlyMessageWithEmptyText() throws {
        let decoder = JSONDecoder()
        let event = try decoder.decode(OpenClawServerMessage.self, from: Data("""
        {
          "sequence": 5,
          "type": "message_created",
          "createdAt": 1777128000000,
          "threadId": "thread-1",
          "messageId": "message-tool-only",
          "message": {
            "id": "message-tool-only",
            "threadId": "thread-1",
            "direction": "openclaw_to_user",
            "authorLabel": "OpenClaw",
            "text": "",
            "links": [],
            "toolCalls": [{
              "id": "call-read",
              "name": "read_file",
              "args": { "path": "~/agents/maude/AGENTS.md" },
              "result": "first lines",
              "status": "complete",
              "insertedAtContentLength": 0,
              "contentSnapshotAtStart": ""
            }],
            "deliveryState": "pending",
            "createdAt": 1777127999000,
            "updatedAt": 1777128000000
          }
        }
        """.utf8))

        guard case .event(let envelope) = event else {
            return XCTFail("Expected event")
        }

        XCTAssertEqual(envelope.message?.text, "")
        let toolCall = try XCTUnwrap(envelope.message?.toolCalls.first)
        XCTAssertEqual(toolCall.id, "call-read")
        XCTAssertEqual(toolCall.name, "read_file")
        XCTAssertEqual(toolCall.args?["path"], .string("~/agents/maude/AGENTS.md"))
    }

    func testPreviewMessageFixturesPreserveToolCalls() throws {
        let toolCall = try XCTUnwrap(CowtailPreviewFixtures.openClawMessageWithActions.toolCalls.first)

        XCTAssertEqual(toolCall.id, "preview-tool")
        XCTAssertEqual(toolCall.name, "query_metrics")
    }

    private func makeMessage(
        text: String,
        direction: OpenClawMessageDirection,
        toolCalls: [OpenClawToolCall]
    ) -> OpenClawMessageWithActions {
        let payload = TestOpenClawMessageWithActionsPayload(
            id: "message-\(direction.rawValue)",
            threadId: "thread-1",
            direction: direction,
            authorLabel: nil,
            text: text,
            links: [],
            toolCalls: toolCalls,
            deliveryState: .sent,
            createdAt: 1,
            updatedAt: 1,
            actions: []
        )

        guard let data = try? JSONEncoder().encode(payload),
              let message = try? JSONDecoder().decode(OpenClawMessageWithActions.self, from: data) else {
            XCTFail("Expected message fixture to decode")
            return CowtailPreviewFixtures.openClawMessageWithActions
        }

        return message
    }

    private struct TestOpenClawMessageWithActionsPayload: Encodable {
        let id: String
        let threadId: String
        let direction: OpenClawMessageDirection
        let authorLabel: String?
        let text: String
        let links: [OpenClawLink]
        let toolCalls: [OpenClawToolCall]
        let deliveryState: OpenClawDeliveryState
        let createdAt: Int64
        let updatedAt: Int64
        let actions: [OpenClawAction]
    }

    private func makeToolCall(
        id: String,
        insertedAtContentLength: Int?,
        contentSnapshotAtStart: String?
    ) -> OpenClawToolCall {
        OpenClawToolCall(
            id: id,
            name: "read_file",
            args: ["path": .string("/tmp/file")],
            result: .string("file contents"),
            status: .complete,
            startedAt: 1,
            completedAt: 2,
            insertedAtContentLength: insertedAtContentLength,
            contentSnapshotAtStart: contentSnapshotAtStart
        )
    }
}
