import Foundation
import OSLog

@MainActor
protocol OpenClawRealtimeConnecting: AnyObject {
    func start(
        sessionToken: String,
        lastSeenSequence: Int64?,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    )
    func stop()
    func send(_ command: OpenClawClientCommand) async throws
}

enum OpenClawRealtimeClientError: LocalizedError {
    case unsupportedURLScheme(String?)
    case notConnected
    case invalidMessage

    var errorDescription: String? {
        switch self {
        case .unsupportedURLScheme(let scheme):
            "OpenClaw realtime URL must use ws or wss, not \(scheme ?? "missing scheme")."
        case .notConnected:
            "OpenClaw realtime client is not connected."
        case .invalidMessage:
            "OpenClaw realtime server sent an unsupported message."
        }
    }
}

@MainActor
final class OpenClawRealtimeClient: OpenClawRealtimeConnecting {
    private typealias MessageHandler = @MainActor (OpenClawServerMessage) -> Void

    private let url: URL
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "openclawRealtime"
    )

    private var webSocketTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var sessionToken: String?
    private var lastSeenSequence: Int64?
    private var onMessage: MessageHandler?
    private var isStarted = false
    private var helloSent = false
    private var reconnectAttempt = 0
    private var connectionGeneration = 0

    init(
        url: URL = AppConfig.openClawRealtimeURL,
        session: URLSession = .shared
    ) {
        self.url = url
        self.session = session
    }

    nonisolated static func makeHelloPayload(sessionToken: String, lastSeenSequence: Int64?) throws -> String {
        let payload = OpenClawHelloPayload(
            protocolVersion: 1,
            clientKind: "ios",
            appSessionToken: sessionToken,
            lastSeenSequence: lastSeenSequence
        )
        let data = try JSONEncoder().encode(payload)
        guard let string = String(data: data, encoding: .utf8) else {
            throw OpenClawRealtimeClientError.invalidMessage
        }
        return string
    }

    nonisolated static func reconnectDelay(attempt: Int) -> Duration {
        switch attempt {
        case ...0:
            .milliseconds(500)
        case 1:
            .seconds(1)
        case 2:
            .seconds(2)
        case 3:
            .seconds(5)
        default:
            .seconds(10)
        }
    }

    func start(
        sessionToken: String,
        lastSeenSequence: Int64?,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    ) {
        stop()

        connectionGeneration += 1
        let generation = connectionGeneration
        self.sessionToken = sessionToken
        self.lastSeenSequence = lastSeenSequence
        self.onMessage = onMessage
        self.isStarted = true
        self.helloSent = false
        self.reconnectAttempt = 0

        guard isWebSocketURL(url) else {
            let error = OpenClawRealtimeClientError.unsupportedURLScheme(url.scheme)
            logger.error("invalid realtime URL: \(error.localizedDescription, privacy: .public)")
            onMessage(.realtimeError(.init(type: "realtime_error", requestId: nil, error: error.localizedDescription)))
            stop()
            return
        }

        connect(generation: generation)
    }

    func stop() {
        connectionGeneration += 1
        isStarted = false
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        helloSent = false
    }

    func send(_ command: OpenClawClientCommand) async throws {
        guard let webSocketTask, helloSent else {
            throw OpenClawRealtimeClientError.notConnected
        }

        let data = try encoder.encode(command)
        guard let string = String(data: data, encoding: .utf8) else {
            throw OpenClawRealtimeClientError.invalidMessage
        }

        try await webSocketTask.send(.string(string))
    }

    private func connect(generation: Int) {
        guard isCurrentConnection(generation), let sessionToken else { return }

        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()

        let task = session.webSocketTask(with: url)
        helloSent = false
        webSocketTask = task
        task.resume()

        receiveTask = Task { @MainActor [weak self, weak task] in
            guard let self, let task else { return }
            do {
                let hello = try Self.makeHelloPayload(
                    sessionToken: sessionToken,
                    lastSeenSequence: lastSeenSequence
                )
                try await task.send(.string(hello))
                guard isCurrentConnection(generation) else { return }
                helloSent = true
                try await receiveLoop(from: task, generation: generation)
            } catch {
                guard isCurrentConnection(generation), !NetworkErrorClassifier.isCancellation(error) else { return }
                logger.error("receive loop failed: \(String(describing: error), privacy: .public)")
                scheduleReconnect(generation: generation)
            }
        }
    }

    private func receiveLoop(from task: URLSessionWebSocketTask, generation: Int) async throws {
        while isCurrentConnection(generation), !Task.isCancelled {
            let message = try await task.receive()
            let data: Data

            switch message {
            case .data(let value):
                data = value
            case .string(let value):
                guard let encoded = value.data(using: .utf8) else {
                    throw OpenClawRealtimeClientError.invalidMessage
                }
                data = encoded
            @unknown default:
                throw OpenClawRealtimeClientError.invalidMessage
            }

            let decoded = try decoder.decode(OpenClawServerMessage.self, from: data)
            guard isCurrentConnection(generation) else { return }
            onMessage?(decoded)
        }
    }

    private func scheduleReconnect(generation: Int) {
        guard isCurrentConnection(generation) else { return }

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        helloSent = false

        let delay = Self.reconnectDelay(attempt: reconnectAttempt)
        reconnectAttempt += 1
        reconnectTask?.cancel()
        reconnectTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: delay)
            } catch {
                return
            }

            guard let self, isCurrentConnection(generation) else { return }
            connect(generation: generation)
        }
    }

    private func isCurrentConnection(_ generation: Int) -> Bool {
        isStarted && generation == connectionGeneration
    }

    private func isWebSocketURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "ws" || scheme == "wss"
    }
}

private struct OpenClawHelloPayload: Encodable {
    let protocolVersion: Int
    let clientKind: String
    let appSessionToken: String
    let lastSeenSequence: Int64?
}
