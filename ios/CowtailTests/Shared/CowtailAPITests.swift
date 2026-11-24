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
          "summary": "Node drain", "ownerDisposition": "escalated", "cause": "Node drain", "fixCommit": "7be01d4",
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
                cause: "Node drain",
                fixCommit: "7be01d4",
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

    private static func itemRecord(_ id: String, snoozedUntil: Int? = nil) -> String {
        let snooze = snoozedUntil.map { #","state":"snoozed","snoozedUntil":\#($0),"needsOwnerWhenOpen":true"# } ?? #","state":"open""#
        return """
        {"id":"\(id)","source":"hermes","sourceInfo":{"slug":"hermes","displayName":"Hermes"},\
        "kind":"fyi","urgency":"today","needsOwner":false,"title":"\(id)","body":"","links":[],\
        "context":{},"occurrenceCount":1,"actions":[],"createdAt":1,"updatedAt":2\(snooze)}
        """
    }

    func testTheInboxKeepsTheServersUpcomingOrderAndReturnTimes() async throws {
        let reply = """
        {"ok":true,"counts":{"needsYou":0,"withHermes":0,"upcoming":7,"handled":0},\
        "needsYou":[],"withHermes":[],"handled":[],\
        "upcoming":[\(Self.itemRecord("later", snoozedUntil: 1_800_000_000_000)),\
        \(Self.itemRecord("sooner", snoozedUntil: 1_700_000_000_000))]}
        """
        let transport = RecordingTransport(routes: ["GET /api/items/inbox": .init(json: reply)])

        let inbox = try await CowtailAPI(transport: transport).fetchInbox(sessionToken: "session")

        XCTAssertEqual(inbox.upcoming.map(\.id), ["later", "sooner"])
        XCTAssertEqual(inbox.upcoming.map(\.snoozedUntil), [Date(timeIntervalSince1970: 1_800_000_000), Date(timeIntervalSince1970: 1_700_000_000)])
        XCTAssertEqual(inbox.upcoming.map(\.needsOwnerWhenOpen), [true, true])
        XCTAssertEqual(inbox.counts.upcoming, 7)
    }

    func testAnInboxFromAServerBeforeUpcomingHasNoUpcomingItems() async throws {
        let reply = """
        {"ok":true,"counts":{"needsYou":1,"withHermes":0,"handled":0},\
        "needsYou":[\(Self.itemRecord("open"))],"withHermes":[],"handled":[]}
        """
        let transport = RecordingTransport(routes: ["GET /api/items/inbox": .init(json: reply)])

        let inbox = try await CowtailAPI(transport: transport).fetchInbox(sessionToken: "session")

        XCTAssertEqual(inbox.upcoming, [])
        XCTAssertEqual(inbox.counts.upcoming, 0)
        XCTAssertEqual(inbox.needsYou.map(\.id), ["open"])
    }

    func testSnoozeOptionsAskInTheGivenZoneAndKeepTheServersOrder() async throws {
        let reply = """
        {"ok":true,"options":[{"preset":"1h","until":1800003600000},{"preset":"4h","until":1800014400000},\
        {"preset":"tomorrow","until":1800050400000},{"preset":"next_monday","until":1800482400000}]}
        """
        let transport = RecordingTransport(routes: ["GET /api/me/snooze-options": .init(json: reply)])

        let options = try await CowtailAPI(transport: transport).fetchSnoozeOptions(timeZone: "Europe/London", sessionToken: "session")

        XCTAssertEqual(options.map(\.preset), [.oneHour, .fourHours, .tomorrow, .nextMonday])
        XCTAssertEqual(options.first?.until, Date(timeIntervalSince1970: 1_800_003_600))
        let sent = try XCTUnwrap(transport.requests("GET /api/me/snooze-options").first)
        let query = URLComponents(string: sent.request.path ?? "")?.queryItems
        XCTAssertEqual(query, [URLQueryItem(name: "timeZone", value: "Europe/London")])
    }

    func testUnsnoozeSendsItsType() async throws {
        let transport = RecordingTransport(routes: [
            "POST /api/me/items/item-1/actions": .init(json: #"{"ok":true,"item":\#(Self.itemRecord("item-1"))}"#),
        ])

        _ = try await CowtailAPI(transport: transport).performItemAction(
            itemID: "item-1",
            request: .unsnooze,
            authenticated: nil,
            sessionToken: "session"
        )

        let sent = try XCTUnwrap(transport.requests("POST /api/me/items/item-1/actions").first)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: sent.body) as? [String: String], ["type": "unsnooze"])
    }

    func testStartingAMaintenanceWindowSendsItsLengthInMillisecondsAndItsScope() async throws {
        let transport = RecordingTransport(routes: [
            "POST /api/me/maintenance-windows": .init(json: #"{"ok":true,"window":\#(Self.windowRecord)}"#),
        ])

        _ = try await CowtailAPI(transport: transport).startMaintenanceWindow(
            MaintenanceWindowRequest(
                title: "Disk swap",
                duration: 90 * 60,
                matchers: [.init(label: "namespace", value: "media")],
                sources: ["hermes"],
                requestID: UUID(uuidString: "0B6F1E2A-4C3D-4E5F-8A9B-0C1D2E3F4A5B")!
            ),
            sessionToken: "session"
        )

        let sent = try XCTUnwrap(transport.requests("POST /api/me/maintenance-windows").first)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: sent.body) as? NSDictionary)
        XCTAssertEqual(
            body,
            [
                "title": "Disk swap",
                "durationMs": 5_400_000,
                "matchers": [["label": "namespace", "value": "media"]],
                "sources": ["hermes"],
                "requestId": "0b6f1e2a-4c3d-4e5f-8a9b-0c1d2e3f4a5b",
            ] as NSDictionary
        )
    }

    func testMaintenanceWindowsKeepTheServersScopeAndSilenceError() async throws {
        let transport = RecordingTransport(routes: [
            "GET /api/me/maintenance-windows": .init(
                json: #"{"ok":true,"active":[\#(Self.windowRecord)],"recent":[],"sourceChoices":["cron","hermes"]}"#
            ),
        ])

        let windows = try await CowtailAPI(transport: transport).fetchMaintenanceWindows(sessionToken: "session")

        XCTAssertEqual(windows.sourceChoices, ["cron", "hermes"])
        XCTAssertEqual(
            windows.active,
            [
                MaintenanceWindow(
                    id: "window-1",
                    title: "Disk swap",
                    startsAt: Date(timeIntervalSince1970: 1_800_000_000),
                    endsAt: Date(timeIntervalSince1970: 1_800_005_400),
                    matchers: [.init(label: "namespace", value: "media")],
                    sources: ["hermes"],
                    allAlerts: false,
                    heldSources: ["hermes"],
                    active: true,
                    silenceError: "Alertmanager answered 503"
                ),
            ]
        )
    }

    private static let windowRecord = """
    {"id":"window-1","title":"Disk swap","startsAt":1800000000000,"endsAt":1800005400000,\
    "createdBy":"owner","matchers":[{"label":"namespace","value":"media"}],"sources":["hermes"],\
    "allAlerts":false,"heldSources":["hermes"],"active":true,"silenceIds":[],"silenceError":"Alertmanager answered 503"}
    """
}
