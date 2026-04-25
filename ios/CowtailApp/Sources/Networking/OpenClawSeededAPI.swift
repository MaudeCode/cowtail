actor OpenClawSeededAPI: OpenClawAPIClient {
    private let seed: UITestScenario.OpenClawSeed
    private var displayName: String

    init(seed: UITestScenario.OpenClawSeed = UITestScenario(named: .openClawPopulated).seed.openClaw) {
        self.seed = seed
        displayName = seed.displayName
    }

    func fetchPreferences(sessionToken _: String) async throws -> String {
        displayName
    }

    func updatePreferences(displayName: String, sessionToken _: String) async throws -> String {
        self.displayName = displayName
        return displayName
    }

    func fetchThreads(sessionToken _: String) async throws -> [OpenClawThread] {
        seed.threads
    }

    func fetchMessages(threadId: String, sessionToken _: String) async throws -> [OpenClawMessageWithActions] {
        seed.messagesByThreadID[threadId] ?? []
    }
}

final class OpenClawSeededRealtime: OpenClawRealtimeConnecting {
    func start(
        sessionToken _: String,
        lastSeenSequence _: Int64?,
        onMessage _: @escaping @MainActor (OpenClawServerMessage) -> Void
    ) {}

    func stop() {}

    func send(_ command: OpenClawClientCommand) async throws {}
}
