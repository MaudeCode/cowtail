import Intents
import UserNotifications
import XCTest

final class SourceNotificationContentTests: XCTestCase {
    private struct Failed: Error {}

    private func push(source: Any?) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = "web v1.8.2 failed its health check"
        content.body = "Rolled back to v1.8.1"
        content.threadIdentifier = "deploy:web"
        if let source {
            content.userInfo = ["itemId": "item-1", "source": source]
        } else {
            content.userInfo = ["itemId": "item-1"]
        }
        return content
    }

    private let deployer: [String: Any] = [
        "slug": "deployer",
        "displayName": "Mac deployer",
        "iconUrl": "https://cowtail.example.com/actions/api/sources/deployer/icon",
    ]

    func testASourceWithAnIconBecomesTheMessagesSender() async throws {
        let loaded = Data([0x89, 0x50, 0x4E, 0x47])
        let built = await SourceNotificationContent.intent(for: push(source: deployer)) { url in
            XCTAssertEqual(url.absoluteString, "https://cowtail.example.com/actions/api/sources/deployer/icon")
            return loaded
        }
        let intent = try XCTUnwrap(built)

        let sender = try XCTUnwrap(intent.sender)
        XCTAssertEqual(sender.displayName, "Mac deployer")
        XCTAssertEqual(sender.customIdentifier, "source:deployer")
        // INImage compares by its data.
        XCTAssertEqual(sender.image, INImage(imageData: loaded))
        XCTAssertEqual(intent.conversationIdentifier, "deploy:web")
        XCTAssertEqual(intent.content, "web v1.8.2 failed its health check\nRolled back to v1.8.1")
    }

    func testTheMessageKeepsTheItemTitleAboveItsBody() async {
        let original = push(source: deployer)
        let delivered = await SourceNotificationContent.content(
            for: original,
            loadIcon: { _ in Data() },
            donate: { _ in }
        )
        // The update replaces the title with the sender's name, so the item's title moves into the text.
        XCTAssertFalse(delivered === original, "The push becomes a message from its source")
        XCTAssertEqual(delivered.body, "web v1.8.2 failed its health check\nRolled back to v1.8.1")
    }

    func testAPushWithoutASourceIsDeliveredAsSent() async {
        let original = push(source: nil)
        let delivered = await SourceNotificationContent.content(
            for: original,
            loadIcon: { _ in XCTFail("No source, no icon"); return Data() },
            donate: { _ in XCTFail("No source, no donation") }
        )
        XCTAssertTrue(delivered === original)
    }

    func testAMalformedSourceIsDeliveredAsSent() async {
        for source: Any in ["deployer", ["slug": "deployer"], ["slug": 7, "displayName": "Mac deployer"]] {
            let original = push(source: source)
            let delivered = await SourceNotificationContent.content(
                for: original,
                loadIcon: { _ in Data() },
                donate: { _ in XCTFail("A malformed source is never donated") }
            )
            XCTAssertTrue(delivered === original, "\(source)")
        }
    }

    func testCowtailsOwnPushKeepsTheAppIconAlone() async {
        let original = push(source: ["slug": "cowtail", "displayName": "Cowtail"])
        let delivered = await SourceNotificationContent.content(
            for: original,
            loadIcon: { _ in Data() },
            donate: { _ in XCTFail("Cowtail's own push is never donated") }
        )
        XCTAssertTrue(delivered === original)
    }

    func testAFailedDonationIsDeliveredAsSent() async {
        let original = push(source: deployer)
        let delivered = await SourceNotificationContent.content(
            for: original,
            loadIcon: { _ in Data([0x89]) },
            donate: { _ in throw Failed() }
        )
        XCTAssertTrue(delivered === original)
    }

    func testAFailedIconDownloadKeepsTheSenderNameWithoutAnImage() async throws {
        let built = await SourceNotificationContent.intent(for: push(source: deployer)) { _ in throw Failed() }
        let intent = try XCTUnwrap(built)
        XCTAssertEqual(intent.sender?.displayName, "Mac deployer")
        XCTAssertNil(intent.sender?.image)
    }

    func testAnIconOver256KBKeepsTheSenderNameWithoutAnImage() async throws {
        let oversized = Data(count: SourceNotificationContent.iconMaxBytes + 1)
        let built = await SourceNotificationContent.intent(for: push(source: deployer)) { _ in oversized }
        let intent = try XCTUnwrap(built)
        XCTAssertEqual(intent.sender?.displayName, "Mac deployer")
        XCTAssertNil(intent.sender?.image)
    }
}
