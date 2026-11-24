import Foundation
import UserNotifications

/// Shows an item push as a message from its source. Whatever goes wrong, the push arrives as
/// it was sent.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?
    private var work: Task<Void, Never>?

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 5
        return URLSession(configuration: configuration)
    }()

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        // UNNotificationContent is immutable, so the task may read it alongside the expiry handler.
        nonisolated(unsafe) let content = request.content
        lock.withLock {
            self.contentHandler = contentHandler
            original = content
        }
        let work = Task {
            deliver(await SourceNotificationContent.content(
                for: content,
                loadIcon: Self.loadIcon,
                donate: { try await $0.donate() }
            ))
        }
        lock.withLock { self.work = work }
    }

    override func serviceExtensionTimeWillExpire() {
        let (work, original) = lock.withLock { (work, original) }
        work?.cancel()
        deliver(original)
    }

    /// Hands over the first content only; the system takes one.
    private func deliver(_ content: UNNotificationContent?) {
        let handler = lock.withLock {
            defer { contentHandler = nil }
            return contentHandler
        }
        if let handler, let content {
            handler(content)
        }
    }

    @Sendable private static func loadIcon(_ url: URL) async throws -> Data {
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}
