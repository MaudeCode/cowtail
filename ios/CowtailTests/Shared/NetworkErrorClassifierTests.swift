import XCTest
import OpenAPIRuntime
@testable import Cowtail

final class NetworkErrorClassifierTests: XCTestCase {
    func testRecognizesOpenAPIWrappedCancellation() {
        let error = ClientError(
            operationID: "query",
            operationInput: "input",
            causeDescription: "Transport threw an error.",
            underlyingError: URLError(.cancelled)
        )

        XCTAssertTrue(NetworkErrorClassifier.isCancellation(error))
    }

    func testRecognizesNestedNSErrorCancellation() {
        let error = NSError(
            domain: "example",
            code: 42,
            userInfo: [NSUnderlyingErrorKey: URLError(.cancelled)]
        )

        XCTAssertTrue(NetworkErrorClassifier.isCancellation(error))
    }

    func testIgnoresNonCancellationErrors() {
        XCTAssertFalse(NetworkErrorClassifier.isCancellation(URLError(.badServerResponse)))
    }
}
