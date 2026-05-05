import Foundation

enum OpenClawThreadStatus: String, Codable, Equatable, Sendable {
    case pending
    case active
    case archived
}

enum OpenClawMessageDirection: String, Codable, Equatable, Sendable {
    case openClawToUser = "openclaw_to_user"
    case userToOpenClaw = "user_to_openclaw"
}

enum OpenClawDeliveryState: String, Codable, Equatable, Sendable {
    case pending
    case sent
    case failed
}

enum OpenClawActionState: String, Codable, Equatable, Sendable {
    case pending
    case submitted
    case failed
    case expired
}

enum OpenClawToolCallStatus: String, Codable, Equatable, Sendable {
    case pending
    case running
    case complete
    case error
}

struct OpenClawLink: Codable, Equatable, Identifiable, Sendable {
    var id: String { url }
    let label: String
    let url: String
}

struct OpenClawToolCall: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let args: [String: JSONValue]?
    let result: JSONValue?
    let status: OpenClawToolCallStatus
    let startedAt: Int64?
    let completedAt: Int64?
    let insertedAtContentLength: Int?
    let contentSnapshotAtStart: String?
}

struct OpenClawThread: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let sessionKey: String?
    let status: OpenClawThreadStatus
    let targetAgent: String
    let title: String
    let unreadCount: Int
    let createdAt: Int64
    let updatedAt: Int64
    let lastMessageAt: Int64?
}

struct OpenClawMessage: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let threadId: String
    let direction: OpenClawMessageDirection
    let authorLabel: String?
    let text: String
    let links: [OpenClawLink]
    let toolCalls: [OpenClawToolCall]
    let deliveryState: OpenClawDeliveryState
    let createdAt: Int64
    let updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case id
        case threadId
        case direction
        case authorLabel
        case text
        case links
        case toolCalls
        case deliveryState
        case createdAt
        case updatedAt
    }

    init(
        id: String,
        threadId: String,
        direction: OpenClawMessageDirection,
        authorLabel: String?,
        text: String,
        links: [OpenClawLink],
        toolCalls: [OpenClawToolCall] = [],
        deliveryState: OpenClawDeliveryState,
        createdAt: Int64,
        updatedAt: Int64
    ) {
        self.id = id
        self.threadId = threadId
        self.direction = direction
        self.authorLabel = authorLabel
        self.text = text
        self.links = links
        self.toolCalls = toolCalls
        self.deliveryState = deliveryState
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        threadId = try container.decode(String.self, forKey: .threadId)
        direction = try container.decode(OpenClawMessageDirection.self, forKey: .direction)
        authorLabel = try container.decodeIfPresent(String.self, forKey: .authorLabel)
        text = try container.decode(String.self, forKey: .text)
        links = try container.decodeIfPresent([OpenClawLink].self, forKey: .links) ?? []
        toolCalls = try container.decodeIfPresent([OpenClawToolCall].self, forKey: .toolCalls) ?? []
        deliveryState = try container.decode(OpenClawDeliveryState.self, forKey: .deliveryState)
        createdAt = try container.decode(Int64.self, forKey: .createdAt)
        updatedAt = try container.decode(Int64.self, forKey: .updatedAt)
    }
}

struct OpenClawAction: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let threadId: String
    let messageId: String
    let label: String
    let kind: String
    let payload: [String: JSONValue]
    let state: OpenClawActionState
    let resultMetadata: [String: JSONValue]?
    let createdAt: Int64
    let updatedAt: Int64
}

struct OpenClawMessageWithActions: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let threadId: String
    let direction: OpenClawMessageDirection
    let authorLabel: String?
    let text: String
    let links: [OpenClawLink]
    let toolCalls: [OpenClawToolCall]
    let deliveryState: OpenClawDeliveryState
    let createdAt: Int64
    let updatedAt: Int64
    let actions: [OpenClawAction]

    enum CodingKeys: String, CodingKey {
        case id
        case threadId
        case direction
        case authorLabel
        case text
        case links
        case toolCalls
        case deliveryState
        case createdAt
        case updatedAt
        case actions
    }

    var message: OpenClawMessage {
        OpenClawMessage(
            id: id,
            threadId: threadId,
            direction: direction,
            authorLabel: authorLabel,
            text: text,
            links: links,
            toolCalls: toolCalls,
            deliveryState: deliveryState,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        threadId = try container.decode(String.self, forKey: .threadId)
        direction = try container.decode(OpenClawMessageDirection.self, forKey: .direction)
        authorLabel = try container.decodeIfPresent(String.self, forKey: .authorLabel)
        text = try container.decode(String.self, forKey: .text)
        links = try container.decodeIfPresent([OpenClawLink].self, forKey: .links) ?? []
        toolCalls = try container.decodeIfPresent([OpenClawToolCall].self, forKey: .toolCalls) ?? []
        deliveryState = try container.decode(OpenClawDeliveryState.self, forKey: .deliveryState)
        createdAt = try container.decode(Int64.self, forKey: .createdAt)
        updatedAt = try container.decode(Int64.self, forKey: .updatedAt)
        actions = try container.decodeIfPresent([OpenClawAction].self, forKey: .actions) ?? []
    }
}

struct OpenClawEventEnvelope: Codable, Equatable, Sendable {
    let sequence: Int64
    let type: String
    let createdAt: Int64
    let threadId: String?
    let messageId: String?
    let actionId: String?
    let thread: OpenClawThread?
    let message: OpenClawMessage?
    let action: OpenClawAction?
    let actions: [OpenClawAction]
    let payload: [String: JSONValue]?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case sequence
        case type
        case createdAt
        case threadId
        case messageId
        case actionId
        case thread
        case message
        case action
        case actions
        case payload
        case error
    }

    init(
        sequence: Int64,
        type: String,
        createdAt: Int64,
        threadId: String? = nil,
        messageId: String? = nil,
        actionId: String? = nil,
        thread: OpenClawThread? = nil,
        message: OpenClawMessage? = nil,
        action: OpenClawAction? = nil,
        actions: [OpenClawAction] = [],
        payload: [String: JSONValue]? = nil,
        error: String? = nil
    ) {
        self.sequence = sequence
        self.type = type
        self.createdAt = createdAt
        self.threadId = threadId
        self.messageId = messageId
        self.actionId = actionId
        self.thread = thread
        self.message = message
        self.action = action
        self.actions = actions
        self.payload = payload
        self.error = error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sequence = try container.decode(Int64.self, forKey: .sequence)
        type = try container.decode(String.self, forKey: .type)
        createdAt = try container.decode(Int64.self, forKey: .createdAt)
        threadId = try container.decodeIfPresent(String.self, forKey: .threadId)
        messageId = try container.decodeIfPresent(String.self, forKey: .messageId)
        actionId = try container.decodeIfPresent(String.self, forKey: .actionId)
        thread = try container.decodeIfPresent(OpenClawThread.self, forKey: .thread)
        message = try container.decodeIfPresent(OpenClawMessage.self, forKey: .message)
        action = try container.decodeIfPresent(OpenClawAction.self, forKey: .action)
        actions = try container.decodeIfPresent([OpenClawAction].self, forKey: .actions) ?? []
        payload = try container.decodeIfPresent([String: JSONValue].self, forKey: .payload)
        error = try container.decodeIfPresent(String.self, forKey: .error)
    }
}

struct OpenClawAck: Codable, Equatable, Sendable {
    let type: String
    let requestId: String
    let sequence: Int64?
}

struct OpenClawRealtimeError: Codable, Equatable, Sendable {
    let type: String
    let requestId: String?
    let error: String
}

struct OpenClawStreamSnapshot: Codable, Equatable, Sendable {
    let type: String
    let streamId: String
    let sessionKey: String
    let threadId: String
    let text: String
    let links: [OpenClawLink]
    let toolCalls: [OpenClawToolCall]
    let isFinal: Bool
    let snapshotSequence: Int64?
    let updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case type
        case streamId
        case sessionKey
        case threadId
        case text
        case links
        case toolCalls
        case isFinal
        case snapshotSequence
        case updatedAt
    }

    init(
        type: String,
        streamId: String,
        sessionKey: String,
        threadId: String,
        text: String,
        links: [OpenClawLink],
        toolCalls: [OpenClawToolCall],
        isFinal: Bool,
        snapshotSequence: Int64? = nil,
        updatedAt: Int64
    ) {
        self.type = type
        self.streamId = streamId
        self.sessionKey = sessionKey
        self.threadId = threadId
        self.text = text
        self.links = links
        self.toolCalls = toolCalls
        self.isFinal = isFinal
        self.snapshotSequence = snapshotSequence
        self.updatedAt = updatedAt
    }
}

extension OpenClawStreamSnapshot {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        streamId = try container.decode(String.self, forKey: .streamId)
        sessionKey = try container.decode(String.self, forKey: .sessionKey)
        threadId = try container.decode(String.self, forKey: .threadId)
        text = try container.decode(String.self, forKey: .text)
        links = try container.decodeIfPresent([OpenClawLink].self, forKey: .links) ?? []
        toolCalls = try container.decodeIfPresent([OpenClawToolCall].self, forKey: .toolCalls) ?? []
        isFinal = try container.decode(Bool.self, forKey: .isFinal)
        snapshotSequence = try container.decodeIfPresent(Int64.self, forKey: .snapshotSequence)
        updatedAt = try container.decode(Int64.self, forKey: .updatedAt)
    }
}

enum OpenClawServerMessage: Decodable, Equatable, Sendable {
    case event(OpenClawEventEnvelope)
    case ack(OpenClawAck)
    case realtimeError(OpenClawRealtimeError)
    case streamSnapshot(OpenClawStreamSnapshot)

    enum CodingKeys: String, CodingKey {
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "ack":
            self = .ack(try OpenClawAck(from: decoder))
        case "realtime_error":
            self = .realtimeError(try OpenClawRealtimeError(from: decoder))
        case "openclaw_message_stream_snapshot":
            self = .streamSnapshot(try OpenClawStreamSnapshot(from: decoder))
        default:
            self = .event(try OpenClawEventEnvelope(from: decoder))
        }
    }
}

struct OpenClawNewThreadCommand: Codable, Equatable, Sendable {
    let requestId: String
    let idempotencyKey: String
    let title: String?
    let text: String
}

struct OpenClawReplyCommand: Codable, Equatable, Sendable {
    let requestId: String
    let idempotencyKey: String
    let threadId: String
    let text: String
}

struct OpenClawActionCommand: Codable, Equatable, Sendable {
    let requestId: String
    let idempotencyKey: String
    let actionId: String
    let payload: [String: JSONValue]
}

struct OpenClawMarkThreadReadCommand: Codable, Equatable, Sendable {
    let requestId: String
    let idempotencyKey: String
    let threadId: String
}

struct OpenClawRenameThreadCommand: Codable, Equatable, Sendable {
    let requestId: String
    let idempotencyKey: String
    let threadId: String
    let title: String
}

struct OpenClawDeleteThreadCommand: Codable, Equatable, Sendable {
    let requestId: String
    let idempotencyKey: String
    let threadId: String
}

enum OpenClawClientCommand: Encodable, Equatable, Sendable {
    case newThread(OpenClawNewThreadCommand)
    case reply(OpenClawReplyCommand)
    case action(OpenClawActionCommand)
    case markThreadRead(OpenClawMarkThreadReadCommand)
    case renameThread(OpenClawRenameThreadCommand)
    case deleteThread(OpenClawDeleteThreadCommand)

    var requestId: String {
        switch self {
        case .newThread(let command):
            return command.requestId
        case .reply(let command):
            return command.requestId
        case .action(let command):
            return command.requestId
        case .markThreadRead(let command):
            return command.requestId
        case .renameThread(let command):
            return command.requestId
        case .deleteThread(let command):
            return command.requestId
        }
    }

    enum CodingKeys: String, CodingKey {
        case type
        case requestId
        case idempotencyKey
        case title
        case text
        case threadId
        case actionId
        case payload
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .newThread(let command):
            try container.encode("ios_new_thread", forKey: .type)
            try container.encode(command.requestId, forKey: .requestId)
            try container.encode(command.idempotencyKey, forKey: .idempotencyKey)
            try container.encodeIfPresent(command.title, forKey: .title)
            try container.encode(command.text, forKey: .text)
        case .reply(let command):
            try container.encode("ios_reply", forKey: .type)
            try container.encode(command.requestId, forKey: .requestId)
            try container.encode(command.idempotencyKey, forKey: .idempotencyKey)
            try container.encode(command.threadId, forKey: .threadId)
            try container.encode(command.text, forKey: .text)
        case .action(let command):
            try container.encode("ios_action", forKey: .type)
            try container.encode(command.requestId, forKey: .requestId)
            try container.encode(command.idempotencyKey, forKey: .idempotencyKey)
            try container.encode(command.actionId, forKey: .actionId)
            try container.encode(command.payload, forKey: .payload)
        case .markThreadRead(let command):
            try container.encode("ios_mark_thread_read", forKey: .type)
            try container.encode(command.requestId, forKey: .requestId)
            try container.encode(command.idempotencyKey, forKey: .idempotencyKey)
            try container.encode(command.threadId, forKey: .threadId)
        case .renameThread(let command):
            try container.encode("ios_rename_thread", forKey: .type)
            try container.encode(command.requestId, forKey: .requestId)
            try container.encode(command.idempotencyKey, forKey: .idempotencyKey)
            try container.encode(command.threadId, forKey: .threadId)
            try container.encode(command.title, forKey: .title)
        case .deleteThread(let command):
            try container.encode("ios_delete_thread", forKey: .type)
            try container.encode(command.requestId, forKey: .requestId)
            try container.encode(command.idempotencyKey, forKey: .idempotencyKey)
            try container.encode(command.threadId, forKey: .threadId)
        }
    }
}

enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}
