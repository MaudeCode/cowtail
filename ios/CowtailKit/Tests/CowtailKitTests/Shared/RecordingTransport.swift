import Foundation
import HTTPTypes
import OpenAPIRuntime

/// A Cowtail server for `CowtailAPI(transport:)`: answers each request from the route for its
/// method and path (query left off), records it, and answers 404 to any other request.
final class RecordingTransport: ClientTransport, @unchecked Sendable {
    struct Route {
        var status: HTTPResponse.Status = .ok
        let json: String
    }

    private let routes: [String: Route]
    private let lock = NSLock()
    private var recorded: [(request: HTTPRequest, body: Data)] = []

    /// Keys are `"<METHOD> <path>"`, such as `"POST /api/auth/logout"`.
    init(routes: [String: Route]) {
        self.routes = routes
    }

    var requests: [(request: HTTPRequest, body: Data)] {
        lock.withLock { recorded }
    }

    func requests(_ key: String) -> [(request: HTTPRequest, body: Data)] {
        requests.filter { Self.key(for: $0.request) == key }
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var full = request
        full.path = baseURL.path + (request.path ?? "")
        let bytes = body == nil ? Data() : try await Data(collecting: body!, upTo: 65_536)
        lock.withLock { recorded.append((full, bytes)) }

        guard let route = routes[Self.key(for: full)] else {
            return (HTTPResponse(status: .notFound), nil)
        }
        var headers = HTTPFields()
        headers[.contentType] = "application/json"
        return (HTTPResponse(status: route.status, headerFields: headers), HTTPBody(route.json))
    }

    private static func key(for request: HTTPRequest) -> String {
        let path = (request.path ?? "").split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        return "\(request.method.rawValue) \(path)"
    }
}
