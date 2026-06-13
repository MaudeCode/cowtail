import OpenAPIRuntime
import XCTest
@testable import Cowtail

final class CowtailAPITests: XCTestCase {
    func testResponseBodyStringKeepsBackendErrorDetails() async {
        let body = HTTPBody("Apple identity token verification failed")

        let message = await CowtailAPI.responseBodyString(from: body)

        XCTAssertEqual(message, "Apple identity token verification failed")
    }
}
