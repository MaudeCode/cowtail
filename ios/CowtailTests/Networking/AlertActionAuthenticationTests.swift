import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest
@testable import Cowtail

final class AlertActionAuthenticationTests: XCTestCase {
    func testAppSessionMiddlewareAddsBearerAuthorization() async throws {
        let middleware = AppSessionAuthorizationMiddleware(sessionToken: "session-token")
        let request = HTTPRequest(
            method: .post,
            scheme: "https",
            authority: "cowtail.example",
            path: "/api/me/alerts/alert-1/actions"
        )

        _ = try await middleware.intercept(
            request,
            body: nil,
            baseURL: URL(string: "https://cowtail.example/api")!,
            operationID: Operations.PerformAlertAction.id
        ) { request, body, _ in
            guard request.headerFields[.authorization] == "Bearer session-token" else {
                throw AuthorizationTestError.missingBearerToken
            }
            return (HTTPResponse(status: .ok), body)
        }
    }
}

private enum AuthorizationTestError: Error {
    case missingBearerToken
}
