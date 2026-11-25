import Foundation
import OpenAPIRuntime

enum NetworkErrorClassifier {
    static func isCancellation(_ error: any Error) -> Bool {
        anyInChain(error) { error in
            error is CancellationError || isURLError(error, codes: [NSURLErrorCancelled])
        }
    }

    /// The device has no network, so the request never reached the server.
    static func isOffline(_ error: any Error) -> Bool {
        anyInChain(error) { error in
            isURLError(error, codes: [
                NSURLErrorNotConnectedToInternet,
                NSURLErrorDataNotAllowed,
                NSURLErrorInternationalRoamingOff,
            ])
        }
    }

    static func isTransientConnectionFailure(_ error: any Error) -> Bool {
        isOffline(error) || anyInChain(error) {
            isURLError($0, codes: [
                NSURLErrorTimedOut,
                NSURLErrorCannotFindHost,
                NSURLErrorCannotConnectToHost,
                NSURLErrorNetworkConnectionLost,
                NSURLErrorDNSLookupFailed,
            ])
        }
    }

    private static func isURLError(_ error: any Error, codes: Set<Int>) -> Bool {
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && codes.contains(nsError.code)
    }

    /// Checks the error and every error it wraps.
    private static func anyInChain(_ error: any Error, _ matches: (any Error) -> Bool) -> Bool {
        if matches(error) {
            return true
        }

        // OpenAPI wraps URLSession transport failures inside ClientError.
        if let clientError = error as? ClientError {
            return anyInChain(clientError.underlyingError, matches)
        }

        if let underlyingError = (error as NSError).userInfo[NSUnderlyingErrorKey] as? any Error {
            return anyInChain(underlyingError, matches)
        }

        return false
    }
}
