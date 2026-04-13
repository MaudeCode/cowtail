import Foundation

actor CowtailAPI {
    private let decoder = JSONDecoder()
    private let convexQueryURL = AppConfig.convexQueryURL
    private let healthSummaryURL = AppConfig.healthSummaryURL
    private let pushRegistrationURL = AppConfig.pushRegistrationURL
    private let pushUnregistrationURL = AppConfig.pushUnregistrationURL

    func fetchAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        let alerts: [AlertDTO] = try await convexQuery(
            path: "alerts:getByTimeRange",
            args: [
                "from": Int(from.timeIntervalSince1970 * 1000),
                "to": Int(to.timeIntervalSince1970 * 1000)
            ]
        )

        return alerts
            .map { $0.asAlertItem }
            .sorted { $0.timestamp > $1.timestamp }
    }

    func fetchAlert(id: String) async throws -> AlertItem? {
        do {
            let alert: AlertDTO? = try await convexQuery(
                path: "alerts:getById",
                args: ["id": id]
            )

            return alert?.asAlertItem
        } catch let error as CowtailAPIError {
            guard case .requestFailed(let message) = error,
                  message.contains("Could not find public function for 'alerts:getById'") else {
                throw error
            }

            let now = Date()
            let fallbackStart = Calendar.current.date(byAdding: .day, value: -30, to: now) ?? now.addingTimeInterval(-30 * 24 * 60 * 60)
            let recentAlerts = try await fetchAlerts(from: fallbackStart, to: now)
            return recentAlerts.first(where: { $0.id == id })
        }
    }

    func fetchFixes(alertIDs: [String]) async throws -> [AlertFix] {
        let fixes: [FixDTO] = try await convexQuery(
            path: "fixes:getByAlertIds",
            args: ["alertIds": alertIDs]
        )

        return fixes
            .map { $0.asAlertFix }
            .sorted { $0.timestamp > $1.timestamp }
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        let (data, response) = try await URLSession.shared.data(from: healthSummaryURL)
        try validate(response: response, data: data)

        let decoded = try decode(
            HealthSummaryDTO.self,
            from: data,
            context: "Health response"
        )

        return decoded.asHealthSummary
    }

    func registerPushDevice(
        identityToken: String,
        deviceToken: String,
        environment: String,
        deviceName: String
    ) async throws -> PushRegistrationResponse {
        try await jsonRequest(
            url: pushRegistrationURL,
            body: [
                "identityToken": identityToken,
                "deviceToken": deviceToken,
                "platform": "ios",
                "environment": environment,
                "deviceName": deviceName
            ]
        )
    }

    func unregisterPushDevice(deviceToken: String) async throws -> PushUnregistrationResponse {
        try await jsonRequest(
            url: pushUnregistrationURL,
            body: [
                "deviceToken": deviceToken
            ]
        )
    }

    private func convexQuery<T: Decodable>(path: String, args: [String: Any]) async throws -> T {
        var request = URLRequest(url: convexQueryURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "path": path,
            "args": args,
            "format": "convex_encoded_json"
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)

        let envelope: ConvexEnvelope<T> = try decode(
            ConvexEnvelope<T>.self,
            from: data,
            context: "Convex response for \(path)"
        )
        if envelope.status == "success", let value = envelope.value {
            return value
        }

        throw CowtailAPIError.requestFailed(envelope.errorMessage ?? "Unknown Convex error")
    }

    private func jsonRequest<T: Decodable>(url: URL, body: [String: Any]) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try decode(T.self, from: data, context: "JSON response")
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw CowtailAPIError.requestFailed(parseErrorMessage(from: data))
        }
    }

    private func parseErrorMessage(from data: Data) -> String {
        if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) {
            return envelope.error
        }

        return String(data: data, encoding: .utf8) ?? "Unknown error"
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data, context: String) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw CowtailAPIError.requestFailed("\(context) decode failed: \(describe(error, data: data))")
        } catch {
            throw error
        }
    }

    private func describe(_ error: DecodingError, data: Data) -> String {
        let snippet = String(data: data.prefix(240), encoding: .utf8)?
            .replacingOccurrences(of: "\n", with: " ") ?? "<non-utf8>"

        switch error {
        case .typeMismatch(let type, let context):
            return "type mismatch for \(type) at \(codingPath(context.codingPath)): \(context.debugDescription). Payload: \(snippet)"
        case .valueNotFound(let type, let context):
            return "missing \(type) at \(codingPath(context.codingPath)): \(context.debugDescription). Payload: \(snippet)"
        case .keyNotFound(let key, let context):
            return "missing key '\(key.stringValue)' at \(codingPath(context.codingPath)): \(context.debugDescription). Payload: \(snippet)"
        case .dataCorrupted(let context):
            return "data corrupted at \(codingPath(context.codingPath)): \(context.debugDescription). Payload: \(snippet)"
        @unknown default:
            return "unknown decoding error. Payload: \(snippet)"
        }
    }

    private func codingPath(_ codingPath: [CodingKey]) -> String {
        if codingPath.isEmpty {
            return "<root>"
        }

        return codingPath.map(\.stringValue).joined(separator: ".")
    }
}

enum CowtailAPIError: LocalizedError {
    case requestFailed(String)

    var errorDescription: String? {
        switch self {
        case .requestFailed(let body):
            return body
        }
    }
}

private struct ConvexEnvelope<T: Decodable>: Decodable {
    let status: String
    let value: T?
    let errorMessage: String?
}

private struct AlertDTO: Decodable {
    let id: String
    let timestamp: Double
    let alertname: String
    let severity: AlertSeverity
    let namespace: String
    let node: String?
    let outcome: AlertOutcome
    let summary: String
    let rootCause: String?
    let action: String?
    let status: AlertLifecycleStatus
    let resolvedAt: Double?
    let messaged: Bool

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case timestamp
        case alertname
        case severity
        case namespace
        case node
        case outcome
        case summary
        case rootCause
        case action
        case status
        case resolvedAt
        case messaged
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        timestamp = try container.decode(Double.self, forKey: .timestamp)
        alertname = try container.decode(String.self, forKey: .alertname)
        severity = try container.decodeIfPresent(AlertSeverity.self, forKey: .severity) ?? .unknown
        namespace = try container.decodeIfPresent(String.self, forKey: .namespace) ?? ""
        node = try container.decodeIfPresent(String.self, forKey: .node)
        outcome = try container.decodeIfPresent(AlertOutcome.self, forKey: .outcome) ?? .unknown
        summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
        rootCause = try container.decodeIfPresent(String.self, forKey: .rootCause)
        action = try container.decodeIfPresent(String.self, forKey: .action)
        status = try container.decodeIfPresent(AlertLifecycleStatus.self, forKey: .status) ?? .unknown
        resolvedAt = try container.decodeIfPresent(Double.self, forKey: .resolvedAt)
        messaged = try container.decodeIfPresent(Bool.self, forKey: .messaged) ?? false
    }

    var asAlertItem: AlertItem {
        AlertItem(
            id: id,
            timestamp: Date(timeIntervalSince1970: timestamp / 1000),
            alertName: alertname,
            severity: severity,
            namespace: namespace,
            node: node ?? "",
            outcome: outcome,
            summary: summary,
            rootCause: rootCause ?? "",
            actionTaken: action ?? "",
            status: status,
            resolvedAt: resolvedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            messaged: messaged
        )
    }
}

private struct FixDTO: Decodable {
    let id: String
    let description: String
    let rootCause: String
    let scope: FixScope
    let timestamp: Double

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case description
        case rootCause
        case scope
        case timestamp
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        rootCause = try container.decodeIfPresent(String.self, forKey: .rootCause) ?? ""
        scope = try container.decodeIfPresent(FixScope.self, forKey: .scope) ?? .unknown
        timestamp = try container.decode(Double.self, forKey: .timestamp)
    }

    var asAlertFix: AlertFix {
        AlertFix(
            id: id,
            description: description,
            rootCause: rootCause,
            scope: scope,
            timestamp: Date(timeIntervalSince1970: timestamp / 1000)
        )
    }
}

private struct HealthSummaryDTO: Decodable {
    let version: Int?
    let nodes: [HealthNodeDTO]
    let cephStatus: String
    let cephMessage: String
    let storageTotal: Double
    let storageUsed: Double
    let storageUnit: String

    var asHealthSummary: HealthSummary {
        HealthSummary(
            nodes: nodes.map(\.asHealthNode),
            cephStatus: cephStatus,
            cephMessage: cephMessage,
            storageTotal: storageTotal,
            storageUsed: storageUsed,
            storageUnit: storageUnit
        )
    }
}

private struct HealthNodeDTO: Decodable {
    let name: String
    let status: String
    let cpu: Int
    let memory: Int

    var asHealthNode: HealthNode {
        HealthNode(
            id: name,
            name: name,
            isReady: status == "Ready",
            cpu: cpu,
            memory: memory
        )
    }
}

struct PushRegistrationResponse: Decodable {
    let ok: Bool
    let created: Bool
    let id: String
}

struct PushUnregistrationResponse: Decodable {
    let ok: Bool
    let updated: Bool
}

private struct APIErrorEnvelope: Decodable {
    let ok: Bool
    let error: String
}
