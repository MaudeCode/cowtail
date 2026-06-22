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
        let envelope = try decoder.decode(OpenClawEventEnvelope.self, from: Data("""
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

        XCTAssertEqual(envelope.sequence, 3)
        XCTAssertEqual(envelope.thread?.title, "Deploy check")
        XCTAssertEqual(envelope.actions.first?.label, "Approve")
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
