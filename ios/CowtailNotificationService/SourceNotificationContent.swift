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
        guard let intent = await intent(for: content, loadIcon: loadIcon) else { return content }
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        do {
            try await donate(interaction)
            return try content.updating(from: intent)
        } catch {
            return content
        }
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
            content: content.body,
            speakableGroupName: nil,
            conversationIdentifier: content.threadIdentifier.isEmpty ? nil : content.threadIdentifier,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        if let image {
            intent.setImage(image, forParameterNamed: \.sender)
        }
        return intent
    }
}
