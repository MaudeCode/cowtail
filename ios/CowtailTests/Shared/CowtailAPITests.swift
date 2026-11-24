import OpenAPIRuntime
import XCTest
@testable import Cowtail

final class CowtailAPITests: XCTestCase {
    func testResponseBodyStringKeepsBackendErrorDetails() async {
        let body = HTTPBody("Apple identity token verification failed")

        let message = await CowtailAPI.responseBodyString(from: body)

        XCTAssertEqual(message, "Apple identity token verification failed")
    }

    /// The server's reply, as `GET /api/hermes/status` sends it.
    private static let hermesReply = """
    {
      "ok": true,
      "status": {
        "receivedAt": 1795521600000,
        "heartbeatMissing": false,
        "statusLevel": "amber",
        "snapshot": {
          "platforms": ["cowtail"],
          "model": "opus-5.5",
          "cronJobs": [],
          "openIncidents": [],
          "budget": {"spent": 4.2, "capped": false},
          "rateLimits": {"anthropic": "ok"}
        },
        "cronJobs": [
          {"id": "job-2", "name": "backup-verify", "schedule": "0 3 * * *", "lastStatus": "error", "failing": true},
          {"id": "job-1", "name": "roundup-digest", "schedule": "0 8 * * *", "failing": false}
        ],
        "cronJobCount": 2,
        "failingCronCount": 1,
        "incidentCount": 2,
        "kanbanBlocked": true,
        "budgetOrder": ["spent", "capped"],
        "rateLimitOrder": ["anthropic"],
        "incidents": [
          {"id": "inc-1", "jobId": "job-2", "state": "open", "jobName": "backup-verify", "itemId": "item-7", "itemTitle": "Backup failed"},
          {"id": "inc-2", "jobId": "job-gone", "state": "open"}
        ]
      },
      "recentAnswers": [
        {"itemId": "item-4", "title": "Rebalance?", "answer": {"type": "choose", "option": "Wait"}, "answeredAt": 1795521600000},
        {"itemId": "item-3", "title": "Restart?", "answer": {"type": "deny"}, "answeredAt": 1795521500000}
      ]
    }
    """

    func testHermesStatusKeepsTheServersLevelOrderLinksAndAnswers() async throws {
        let transport = RecordingTransport(routes: ["GET /api/hermes/status": .init(json: Self.hermesReply)])

        let status = try await CowtailAPI(transport: transport).fetchHermesStatus(sessionToken: "session")

        let heartbeat = try XCTUnwrap(status.heartbeat)
        XCTAssertEqual(heartbeat.level, .amber)
        XCTAssertEqual(heartbeat.cronJobs.map(\.id), ["job-2", "job-1"])
        XCTAssertEqual(heartbeat.cronJobs.map(\.failing), [true, false])
        XCTAssertEqual(
            [heartbeat.cronJobCount, heartbeat.failingCronCount, heartbeat.incidentCount],
            [2, 1, 2]
        )
        XCTAssertTrue(heartbeat.kanbanBlocked)
        XCTAssertEqual(heartbeat.incidents.map(\.itemID), ["item-7", nil])
        XCTAssertEqual(heartbeat.incidents.map(\.jobName), ["backup-verify", "job-gone"])
        XCTAssertEqual(
            heartbeat.budget,
            [.init(key: "spent", value: "4.2"), .init(key: "capped", value: "no")]
        )
        XCTAssertEqual(heartbeat.rateLimits, [.init(key: "anthropic", value: "ok")])
        XCTAssertEqual(status.recentAnswers.map(\.answer), [.choose("Wait"), .deny])
    }

    /// An item's detail, as `GET /api/items/:id` sends it.
    private static let itemReply = """
    {
      "ok": true,
      "item": {
        "id": "item-1", "source": "alertmanager",
        "sourceInfo": {"slug": "alertmanager", "displayName": "Alertmanager"},
        "kind": "alert", "urgency": "now", "state": "resolved", "needsOwner": false,
        "title": "KubePodCrashLooping", "body": "", "links": [], "context": {},
        "occurrenceCount": 1, "actions": [], "createdAt": 1795521600000, "updatedAt": 1795521600000
      },
      "events": [
        {
          "id": "event-1", "itemId": "item-1", "at": 1795521600000, "type": "hermes_update",
          "actor": "hermes", "payload": {"text": "Raised the limit"},
          "evidence": [
            {"step": "Read logs", "command": "kubectl logs api", "output": "OOMKilled", "at": 1795521600000},
            {"step": "Raise the limit"}
          ]
        }
      ],
      "priorOccurrences": [
        {
          "alertId": "alert-0", "firedAt": 1795435200000, "outcome": "self-resolved",
          "summary": "Node drain", "ownerDisposition": "escalated",
          "fixes": [{"description": "Cordon the node", "rootCause": "Bad disk", "commit": "7be01d4"}]
        }
      ]
    }
    """

    func testItemDetailKeepsHermesEvidenceAndPastOccurrences() async throws {
        let transport = RecordingTransport(routes: ["GET /api/items/item-1": .init(json: Self.itemReply)])

        let fetched = try await CowtailAPI(transport: transport).fetchItem(id: "item-1", sessionToken: "session")
        let detail = try XCTUnwrap(fetched)

        XCTAssertEqual(detail.events.first?.evidence, [
            EvidenceStep(step: "Read logs", command: "kubectl logs api", output: "OOMKilled"),
            EvidenceStep(step: "Raise the limit"),
        ])
        XCTAssertEqual(detail.priorOccurrences, [
            PriorOccurrence(
                alertID: "alert-0",
                firedAt: Date(timeIntervalSince1970: 1_795_435_200),
                outcome: .selfResolved,
                rootCause: nil,
                summary: "Node drain",
                fixes: [.init(description: "Cordon the node", rootCause: "Bad disk", commit: "7be01d4")]
            ),
        ])
    }

    func testHermesStatusBeforeTheFirstHeartbeatHasNoHeartbeat() async throws {
        let transport = RecordingTransport(routes: [
            "GET /api/hermes/status": .init(json: #"{"ok": true, "status": null, "recentAnswers": []}"#),
        ])

        let status = try await CowtailAPI(transport: transport).fetchHermesStatus(sessionToken: "session")

        XCTAssertNil(status.heartbeat)
    }
}
