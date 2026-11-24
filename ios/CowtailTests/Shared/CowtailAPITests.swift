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
}
