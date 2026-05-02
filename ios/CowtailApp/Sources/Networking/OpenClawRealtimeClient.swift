import Foundation
import OSLog

@MainActor
protocol OpenClawRealtimeConnecting: AnyObject {
    func start(
        sessionToken: String,
        lastSeenSequence: Int64?,
        onConnectionStateChange: @escaping @MainActor (OpenClawRealtimeTransportState) -> Void,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    )
    func stop()
    func send(_ command: OpenClawClientCommand) async throws
}

enum OpenClawRealtimeTransportState: Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting
    case failed(String)
}

enum OpenClawRealtimeClientError: LocalizedError {
    case unsupportedURLScheme(String?)
    case notConnected
    case invalidMessage
    case commandRejected(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedURLScheme(let scheme):
            "OpenClaw realtime URL must use ws or wss, not \(scheme ?? "missing scheme")."
        case .notConnected:
            "OpenClaw realtime client is not connected."
        case .invalidMessage:
            "OpenClaw realtime server sent an unsupported message."
        case .commandRejected(let message):
            "OpenClaw rejected the command: \(message)."
        }
    }
}

@MainActor
final class OpenClawRealtimeClient: OpenClawRealtimeConnecting {
    private typealias MessageHandler = @MainActor (OpenClawServerMessage) -> Void
    private static let commandAckTimeout: Duration = .seconds(15)

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
    private var onConnectionStateChange: (@MainActor (OpenClawRealtimeTransportState) -> Void)?
    private var onMessage: MessageHandler?
    private var isStarted = false
    private var helloSent = false
    private var reconnectAttempt = 0
    private var connectionGeneration = 0
    private var pendingCommandContinuations: [String: CheckedContinuation<Void, Error>] = [:]

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
        onConnectionStateChange: @escaping @MainActor (OpenClawRealtimeTransportState) -> Void,
        onMessage: @escaping @MainActor (OpenClawServerMessage) -> Void
    ) {
        stop(notify: false)

        connectionGeneration += 1
        let generation = connectionGeneration
        self.sessionToken = sessionToken
        self.lastSeenSequence = lastSeenSequence
        self.onConnectionStateChange = onConnectionStateChange
        self.onMessage = onMessage
        self.isStarted = true
        self.helloSent = false
        self.reconnectAttempt = 0
        onConnectionStateChange(.connecting)

        guard isWebSocketURL(url) else {
            let error = OpenClawRealtimeClientError.unsupportedURLScheme(url.scheme)
            logger.error("invalid realtime URL: \(error.localizedDescription, privacy: .public)")
            onConnectionStateChange(.failed(error.localizedDescription))
            onMessage(.realtimeError(.init(type: "realtime_error", requestId: nil, error: error.localizedDescription)))
            stop(notify: false)
            return
        }

        connect(generation: generation)
    }

    func stop() {
        stop(notify: true)
    }

    private func stop(notify: Bool) {
        connectionGeneration += 1
        isStarted = false
        reconnectTask?.cancel()
        reconnectTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        helloSent = false
        rejectPendingCommands(OpenClawRealtimeClientError.notConnected)
        if notify {
            onConnectionStateChange?(.disconnected)
        }
    }

    func send(_ command: OpenClawClientCommand) async throws {
        guard let webSocketTask, helloSent else {
            throw OpenClawRealtimeClientError.notConnected
        }

        let data = try encoder.encode(command)
        guard let string = String(data: data, encoding: .utf8) else {
            throw OpenClawRealtimeClientError.invalidMessage
        }

        try await withCheckedThrowingContinuation { continuation in
            pendingCommandContinuations[command.requestId] = continuation
            Task { @MainActor [weak self, weak webSocketTask] in
                guard let self else { return }
                do {
                    guard self.webSocketTask === webSocketTask else {
                        throw OpenClawRealtimeClientError.notConnected
                    }
                    try await webSocketTask?.send(.string(string))
                } catch {
                    self.resolvePendingCommand(command.requestId, result: .failure(error))
                }
            }
            Task { @MainActor [weak self] in
                do {
                    try await Task.sleep(for: Self.commandAckTimeout)
                } catch {
                    return
                }
                self?.resolvePendingCommand(
                    command.requestId,
                    result: .failure(OpenClawRealtimeClientError.commandRejected("ack_timeout"))
                )
            }
        }
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
            if case .event(let event) = decoded, event.type == "hello_acknowledged" {
                reconnectAttempt = 0
                helloSent = true
                onConnectionStateChange?(.connected)
            } else if case .ack(let ack) = decoded {
                resolvePendingCommand(ack.requestId, result: .success(()))
            } else if case .realtimeError(let error) = decoded, let requestId = error.requestId {
                resolvePendingCommand(
                    requestId,
                    result: .failure(OpenClawRealtimeClientError.commandRejected(error.error))
                )
            }
            onMessage?(decoded)
        }
    }

    private func scheduleReconnect(generation: Int) {
        guard isCurrentConnection(generation) else { return }

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        helloSent = false
        rejectPendingCommands(OpenClawRealtimeClientError.notConnected)

        let delay = Self.reconnectDelay(attempt: reconnectAttempt)
        reconnectAttempt += 1
        onConnectionStateChange?(.reconnecting)
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

    private func resolvePendingCommand(_ requestId: String, result: Result<Void, Error>) {
        guard let continuation = pendingCommandContinuations.removeValue(forKey: requestId) else {
            return
        }

        continuation.resume(with: result)
    }

    private func rejectPendingCommands(_ error: Error) {
        let continuations = pendingCommandContinuations
        pendingCommandContinuations.removeAll()
        for continuation in continuations.values {
            continuation.resume(throwing: error)
        }
    }
}

private struct OpenClawHelloPayload: Encodable {
    let protocolVersion: Int
    let clientKind: String
    let appSessionToken: String
    let lastSeenSequence: Int64?
}
