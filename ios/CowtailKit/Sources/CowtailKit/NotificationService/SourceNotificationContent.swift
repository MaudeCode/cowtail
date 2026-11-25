import Foundation
import Intents
import UserNotifications

/// Turns an item push into a Communication Notification from its source: the source's icon as
/// the large image, its display name as the sender. A push it cannot show that way keeps its
/// content as sent.
enum SourceNotificationContent {
    /// The largest icon it shows, the size the server accepts on upload.
    static let iconMaxBytes = 256 * 1024
    /// Cowtail's own pushes, such as the summary of a batch, keep the app icon alone.
    static let appSourceSlug = "cowtail"

    typealias IconLoader = @Sendable (URL) async throws -> Data
    typealias Donor = @Sendable (INInteraction) async throws -> Void

    /// The content to deliver: the push as a message from its source, or the push as sent when
    /// it names no source to show or the donation or update fails.
    static func content(
        for content: UNNotificationContent,
        loadIcon: IconLoader,
        donate: Donor
    ) async -> UNNotificationContent {
        guard let intent = await intent(for: content, loadIcon: loadIcon),
              let message = content.mutableCopy() as? UNMutableNotificationContent
        else { return content }
        // The update replaces the title with the sender's name, so the item's title leads the text.
        message.body = text(of: content)
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        do {
            try await donate(interaction)
            return try message.updating(from: intent)
        } catch {
            return content
        }
    }

    /// The item's title above its body: what the message shows under the sender's name.
    static func text(of content: UNNotificationContent) -> String {
        [content.title, content.body].filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// The push's `source`, as the server's `sourceInfo` sends it.
    struct Source: Decodable, Equatable {
        let slug: String
        let displayName: String
        let iconUrl: String?
    }

    static func source(of content: UNNotificationContent) -> Source? {
        guard
            let value = content.userInfo["source"],
            JSONSerialization.isValidJSONObject(value),
            let data = try? JSONSerialization.data(withJSONObject: value),
            let source = try? JSONDecoder().decode(Source.self, from: data),
            !source.slug.isEmpty,
            !source.displayName.isEmpty,
            source.slug != appSourceSlug
        else { return nil }
        return source
    }

    /// The message intent to show the push as, or nil when the push names no source to show.
    /// A missing, failed or oversized icon leaves the sender without an image.
    static func intent(for content: UNNotificationContent, loadIcon: IconLoader) async -> INSendMessageIntent? {
        guard let source = source(of: content) else { return nil }

        var image: INImage?
        if let url = source.iconUrl.flatMap(URL.init(string:)),
           let data = try? await loadIcon(url),
           !data.isEmpty,
           data.count <= iconMaxBytes {
            image = INImage(imageData: data)
        }

        let identifier = "source:\(source.slug)"
        let sender = INPerson(
            personHandle: INPersonHandle(value: identifier, type: .unknown),
            nameComponents: nil,
            displayName: source.displayName,
            image: image,
            contactIdentifier: nil,
            customIdentifier: identifier
        )
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: text(of: content),
            speakableGroupName: nil,
            conversationIdentifier: content.threadIdentifier.isEmpty ? nil : content.threadIdentifier,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        #if os(iOS)
            // The image the notification shows; macOS, where only the tests run, has no such parameter.
            if let image {
                intent.setImage(image, forParameterNamed: \.sender)
            }
        #endif
        return intent
    }
}
