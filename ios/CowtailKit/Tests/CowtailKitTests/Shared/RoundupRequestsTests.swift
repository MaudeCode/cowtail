import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest
@testable import CowtailKit

final class RoundupRequestsTests: XCTestCase {
    func testTheRoundupReadsAlertsAndFixesWithTheSessionOverTheRange() async throws {
        let transport = RoundupTransport()
        let api = CowtailAPI(transport: transport)
        let from = Date(timeIntervalSince1970: 1_800_000_000)
        let to = Date(timeIntervalSince1970: 1_800_086_399)

        let alerts = try await api.fetchAlerts(from: from, to: to, sessionToken: "session-token")
        let fixes = try await api.fetchFixes(from: from, to: to, sessionToken: "session-token")

        XCTAssertEqual(
            transport.requests.map { [$0.method.rawValue, $0.path ?? "", $0.headerFields[.authorization] ?? ""] },
            [
                ["GET", "/api/alerts?from=1800000000000&to=1800086399000", "Bearer session-token"],
                ["GET", "/api/fixes?from=1800000000000&to=1800086399000", "Bearer session-token"],
            ]
        )
        XCTAssertEqual(alerts.map(\.alertName), ["TargetDown"])
        XCTAssertEqual(fixes.map(\.description), ["Raised the memory limit"])
    }
}

/// Answers the alert and fix lists as the server does, and records each request.
private final class RoundupTransport: ClientTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [HTTPRequest] = []

    var requests: [HTTPRequest] {
        lock.withLock { recorded }
    }

    func send(
        _ request: HTTPRequest,
        body _: HTTPBody?,
        baseURL: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var full = request
        full.path = baseURL.path + (request.path ?? "")
        lock.withLock { recorded.append(full) }

        let reply = (full.path ?? "").hasPrefix("/api/alerts")
            ? """
            {"ok":true,"count":1,"alerts":[{"id":"alert-1","timestamp":1800000100000,\
            "alertname":"TargetDown","severity":"warning","namespace":"monitoring",\
            "status":"resolved","outcome":"noise","summary":"Down","action":"None",\
            "messaged":false}]}
            """
            : """
            {"ok":true,"count":1,"fixes":[{"id":"fix-1","timestamp":1800000200000,\
            "alertIds":["alert-1"],"description":"Raised the memory limit",\
            "rootCause":"OOM","scope":"reactive"}]}
            """
        var headers = HTTPFields()
        headers[.contentType] = "application/json"
        return (HTTPResponse(status: .ok, headerFields: headers), HTTPBody(reply))
    }
}
