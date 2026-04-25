import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

protocol OpenClawAPIClient: Sendable {
    func fetchPreferences(sessionToken: String) async throws -> String
    func updatePreferences(displayName: String, sessionToken: String) async throws -> String
    func fetchThreads(sessionToken: String) async throws -> [OpenClawThread]
    func fetchMessages(threadId: String, sessionToken: String) async throws -> [OpenClawMessageWithActions]
}

actor OpenClawAPI: OpenClawAPIClient {
    private let transport: URLSessionTransport

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 30
        self.transport = URLSessionTransport(
            configuration: .init(session: URLSession(configuration: configuration))
        )
    }

    private func client(sessionToken: String) -> Client {
        Client(
            serverURL: AppConfig.baseURL(for: AppConfig.authSessionURL, droppingLastPathComponents: 2),
            transport: transport,
            middlewares: [OpenClawAuthorizationMiddleware(sessionToken: sessionToken)]
        )
    }

    func fetchPreferences(sessionToken: String) async throws -> String {
        let output = try await client(sessionToken: sessionToken).getOpenClawPreferences()
        switch output {
        case .ok(let response):
            return try response.body.json.preferences.displayName ?? ""
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("OpenClaw preferences request failed with status \(statusCode).")
        }
    }

    func updatePreferences(displayName: String, sessionToken: String) async throws -> String {
        let output = try await client(sessionToken: sessionToken).updateOpenClawPreferences(
            body: .json(.init(displayName: displayName))
        )
        switch output {
        case .ok(let response):
            return try response.body.json.preferences.displayName ?? ""
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("OpenClaw preferences update failed with status \(statusCode).")
        }
    }

    func fetchThreads(sessionToken: String) async throws -> [OpenClawThread] {
        let output = try await client(sessionToken: sessionToken).listOpenClawThreads()
        switch output {
        case .ok(let response):
            let data = try JSONEncoder().encode(response.body.json.threads)
            return try JSONDecoder().decode([OpenClawThread].self, from: data)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("OpenClaw thread list failed with status \(statusCode).")
        }
    }

    func fetchMessages(threadId: String, sessionToken: String) async throws -> [OpenClawMessageWithActions] {
        let output = try await client(sessionToken: sessionToken).listOpenClawThreadMessages(
            path: .init(threadId: threadId)
        )
        switch output {
        case .ok(let response):
            let data = try JSONEncoder().encode(response.body.json.messages)
            return try JSONDecoder().decode([OpenClawMessageWithActions].self, from: data)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("OpenClaw message list failed with status \(statusCode).")
        }
    }
}

private struct OpenClawAuthorizationMiddleware: ClientMiddleware {
    let sessionToken: String

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[.authorization] = "Bearer \(sessionToken)"
        return try await next(request, body, baseURL)
    }
}
