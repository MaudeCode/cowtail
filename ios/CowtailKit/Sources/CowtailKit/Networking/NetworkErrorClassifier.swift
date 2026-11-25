import Foundation
import OpenAPIRuntime

enum NetworkErrorClassifier {
    static func isCancellation(_ error: any Error) -> Bool {
        if error is CancellationError {
            return true
        }

        // OpenAPI wraps URLSession transport failures inside ClientError.
        if let clientError = error as? ClientError {
            return isCancellation(clientError.underlyingError)
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return true
        }

        if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? any Error,
           isCancellation(underlyingError) {
            return true
        }

        return false
    }
}
