import Foundation
import OpenAPIRuntime
import OpenAPIURLSession
import OSLog

actor CowtailAPI {
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "network"
    )
    private let transport = URLSessionTransport()

    private var queryClient: Client {
        Client(
            serverURL: AppConfig.baseURL(for: AppConfig.convexQueryURL, droppingLastPathComponents: 1),
            transport: transport
        )
    }

    private var healthClient: Client {
        Client(
            serverURL: AppConfig.baseURL(for: AppConfig.healthSummaryURL, droppingLastPathComponents: 1),
            transport: transport
        )
    }

    private var pushRegistrationClient: Client {
        Client(
            serverURL: AppConfig.baseURL(for: AppConfig.pushRegistrationURL, droppingLastPathComponents: 2),
            transport: transport
        )
    }

    private var pushUnregistrationClient: Client {
        Client(
            serverURL: AppConfig.baseURL(for: AppConfig.pushUnregistrationURL, droppingLastPathComponents: 2),
            transport: transport
        )
    }

    func fetchAlerts(from: Date, to: Date) async throws -> [AlertItem] {
        logger.info("fetchAlerts baseURL=\(AppConfig.baseURL(for: AppConfig.convexQueryURL, droppingLastPathComponents: 1).absoluteString, privacy: .public)")
        let output = try await queryClient.query(
            body: .json(
                .init(
                    value1: .init(
                        path: .alerts_colon_getByTimeRange,
                        args: .init(
                            from: milliseconds(from),
                            to: milliseconds(to)
                        ),
                        format: .convexEncodedJson
                    )
                )
            )
        )

        switch output {
        case let .ok(response):
            let payload = try response.body.json
            guard let envelope = payload.value1 else {
                throw CowtailAPIError.requestFailed("Query returned the wrong response shape for alerts.")
            }

            switch envelope.status {
            case .success:
                return (envelope.value ?? [])
                    .map(makeAlertItem)
                    .sorted { $0.timestamp > $1.timestamp }
            case .error:
                throw CowtailAPIError.requestFailed(envelope.errorMessage ?? "Unknown Convex error")
            }
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "query.fetchAlerts",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Alert list request failed with status \(statusCode): \(body)")
        }
    }

    func fetchAlert(id: String) async throws -> AlertItem? {
        let output = try await queryClient.query(
            body: .json(
                .init(
                    value2: .init(
                        path: .alerts_colon_getById,
                        args: .init(id: id),
                        format: .convexEncodedJson
                    )
                )
            )
        )

        switch output {
        case let .ok(response):
            let payload = try response.body.json
            guard let envelope = payload.value2 else {
                throw CowtailAPIError.requestFailed("Query returned the wrong response shape for alert fetch.")
            }

            switch envelope.status {
            case .success:
                return envelope.value?.value1.map(makeAlertItem)
            case .error:
                throw CowtailAPIError.requestFailed(envelope.errorMessage ?? "Unknown Convex error")
            }
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "query.fetchAlert",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Alert fetch failed with status \(statusCode): \(body)")
        }
    }

    func fetchFixes(alertIDs: [String]) async throws -> [AlertFix] {
        let output = try await queryClient.query(
            body: .json(
                .init(
                    value3: .init(
                        path: .fixes_colon_getByAlertIds,
                        args: .init(alertIds: alertIDs),
                        format: .convexEncodedJson
                    )
                )
            )
        )

        switch output {
        case let .ok(response):
            let payload = try response.body.json
            guard let envelope = payload.value3 else {
                throw CowtailAPIError.requestFailed("Query returned the wrong response shape for fixes.")
            }

            switch envelope.status {
            case .success:
                return (envelope.value ?? [])
                    .map(makeAlertFix)
                    .sorted { $0.timestamp > $1.timestamp }
            case .error:
                throw CowtailAPIError.requestFailed(envelope.errorMessage ?? "Unknown Convex error")
            }
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "query.fetchFixes",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Fix list request failed with status \(statusCode): \(body)")
        }
    }

    func fetchFixes(from: Date, to: Date) async throws -> [AlertFix] {
        let output = try await queryClient.query(
            body: .json(
                .init(
                    value4: .init(
                        path: .fixes_colon_getByTimeRange,
                        args: .init(
                            from: milliseconds(from),
                            to: milliseconds(to)
                        ),
                        format: .convexEncodedJson
                    )
                )
            )
        )

        switch output {
        case let .ok(response):
            let payload = try response.body.json
            guard let envelope = payload.value3 else {
                throw CowtailAPIError.requestFailed("Query returned the wrong response shape for fixes.")
            }

            switch envelope.status {
            case .success:
                return (envelope.value ?? [])
                    .map(makeAlertFix)
                    .sorted { $0.timestamp > $1.timestamp }
            case .error:
                throw CowtailAPIError.requestFailed(envelope.errorMessage ?? "Unknown Convex error")
            }
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "query.fetchFixesByTimeRange",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Fix range request failed with status \(statusCode): \(body)")
        }
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        let output = try await healthClient.fetchHealthSummary()

        switch output {
        case let .ok(response):
            return makeHealthSummary(try response.body.json)
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "fetchHealthSummary",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Health request failed with status \(statusCode): \(body)")
        }
    }

    func registerPushDevice(
        identityToken: String,
        deviceToken: String,
        environment: String,
        deviceName: String
    ) async throws -> PushRegistrationResponse {
        let output = try await pushRegistrationClient.registerPushDevice(
            body: .json(
                .init(
                    identityToken: identityToken,
                    deviceToken: deviceToken,
                    platform: "ios",
                    environment: environment,
                    deviceName: deviceName
                )
            )
        )

        switch output {
        case let .ok(response):
            return try response.body.json
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "registerPushDevice",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Push registration failed with status \(statusCode): \(body)")
        }
    }

    func unregisterPushDevice(deviceToken: String) async throws -> PushUnregistrationResponse {
        let output = try await pushUnregistrationClient.unregisterPushDevice(
            body: .json(.init(deviceToken: deviceToken))
        )

        switch output {
        case let .ok(response):
            return try response.body.json
        case let .undocumented(statusCode, payload):
            await logUndocumentedResponse(
                operation: "unregisterPushDevice",
                statusCode: statusCode,
                payload: payload
            )
            let body = await bodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Push unregistration failed with status \(statusCode): \(body)")
        }
    }

    func createAuthSession(identityToken: String) async throws -> AppAuthSession {
        let response: AuthSessionCreateResponse = try await sendJSONRequest(
            url: AppConfig.authSessionURL,
            method: "POST",
            body: AuthSessionCreateRequest(identityToken: identityToken)
        )

        return AppAuthSession(
            token: response.session.token,
            userID: response.session.userId,
            expiresAt: Date(timeIntervalSince1970: TimeInterval(response.session.expiresAt) / 1000)
        )
    }

    func fetchNotificationPreferences(sessionToken: String) async throws -> AppNotificationPreferences {
        let response: NotificationPreferencesResponse = try await sendJSONRequest(
            url: AppConfig.notificationPreferencesURL,
            method: "GET",
            bearerToken: sessionToken
        )

        return AppNotificationPreferences(dailyDigestEnabled: response.preferences.dailyDigestEnabled)
    }

    func updateNotificationPreferences(
        sessionToken: String,
        dailyDigestEnabled: Bool
    ) async throws -> AppNotificationPreferences {
        let response: NotificationPreferencesResponse = try await sendJSONRequest(
            url: AppConfig.notificationPreferencesURL,
            method: "PUT",
            body: NotificationPreferencesUpdateRequest(dailyDigestEnabled: dailyDigestEnabled),
            bearerToken: sessionToken
        )

        return AppNotificationPreferences(dailyDigestEnabled: response.preferences.dailyDigestEnabled)
    }

    private func makeAlertItem(_ record: Components.Schemas.ConvexAlertRecord) -> AlertItem {
        AlertItem(
            id: record._id,
            timestamp: Date(timeIntervalSince1970: record.timestamp / 1000),
            alertName: record.alertname,
            severity: AlertSeverity(rawValue: record.severity) ?? .unknown,
            namespace: record.namespace,
            node: record.node ?? "",
            outcome: AlertOutcome(rawValue: record.outcome) ?? .unknown,
            summary: record.summary,
            rootCause: record.rootCause ?? "",
            actionTaken: record.action ?? "",
            status: AlertLifecycleStatus(rawValue: record.status) ?? .unknown,
            resolvedAt: record.resolvedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            messaged: record.messaged ?? false
        )
    }

    private func makeAlertFix(_ record: Components.Schemas.ConvexFixRecord) -> AlertFix {
        AlertFix(
            id: record._id,
            description: record.description ?? "",
            rootCause: record.rootCause ?? "",
            scope: FixScope(rawValue: record.scope ?? "") ?? .unknown,
            timestamp: Date(timeIntervalSince1970: record.timestamp / 1000)
        )
    }

    private func makeHealthSummary(_ payload: Components.Schemas.HealthResponse) -> HealthSummary {
        HealthSummary(
            nodes: payload.nodes.map {
                HealthNode(
                    id: $0.name,
                    name: $0.name,
                    isReady: $0.status == .ready,
                    cpu: Int($0.cpu.rounded()),
                    memory: Int($0.memory.rounded())
                )
            },
            cephStatus: payload.cephStatus.rawValue,
            cephMessage: payload.cephMessage,
            storageTotal: payload.storageTotal,
            storageUsed: payload.storageUsed,
            storageUnit: payload.storageUnit
        )
    }

    private func milliseconds(_ date: Date) -> Double {
        date.timeIntervalSince1970 * 1000
    }

    private func sendJSONRequest<ResponseBody: Decodable>(
        url: URL,
        method: String,
        bearerToken: String? = nil
    ) async throws -> ResponseBody {
        try await sendJSONRequest(url: url, method: method, body: Optional<String>.none, bearerToken: bearerToken)
    }

    private func sendJSONRequest<RequestBody: Encodable, ResponseBody: Decodable>(
        url: URL,
        method: String,
        body: RequestBody?,
        bearerToken: String? = nil
    ) async throws -> ResponseBody {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let bearerToken, !bearerToken.isEmpty {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CowtailAPIError.requestFailed("Request returned an invalid response.")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let body = String(decoding: data, as: UTF8.self)
            if let payload = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
                throw CowtailAPIError.requestFailed("Request failed with status \(httpResponse.statusCode): \(payload.error)")
            }

            throw CowtailAPIError.requestFailed(
                "Request failed with status \(httpResponse.statusCode): \(body.isEmpty ? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode) : body)"
            )
        }

        do {
            return try JSONDecoder().decode(ResponseBody.self, from: data)
        } catch {
            throw CowtailAPIError.requestFailed("Request returned an invalid JSON payload.")
        }
    }

    private func logUndocumentedResponse(
        operation: String,
        statusCode: Int,
        payload: UndocumentedPayload
    ) async {
        let body = await bodyString(from: payload.body)
        logger.error(
            "\(operation, privacy: .public) undocumented response status=\(statusCode, privacy: .public) headers=\(String(describing: payload.headerFields), privacy: .public) body=\(body, privacy: .public)"
        )
    }

    private func bodyString(from body: HTTPBody?) async -> String {
        guard let body else {
            return "<empty>"
        }

        do {
            let bytes = try await Array(collecting: body, upTo: 32_768)
            return String(decoding: bytes, as: UTF8.self)
        } catch {
            return "<unreadable body: \(error)>"
        }
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

typealias PushRegistrationResponse = Components.Schemas.PushRegisterResponse
typealias PushUnregistrationResponse = Components.Schemas.PushUnregisterResponse
typealias AuthSessionCreateRequest = Components.Schemas.AuthSessionCreateRequest
typealias AuthSessionCreateResponse = Components.Schemas.AuthSessionCreateResponse
typealias NotificationPreferencesResponse = Components.Schemas.NotificationPreferencesResponse
typealias NotificationPreferencesUpdateRequest = Components.Schemas.NotificationPreferencesUpdateRequest

struct AppAuthSession: Sendable {
    let token: String
    let userID: String
    let expiresAt: Date
}

struct AppNotificationPreferences: Sendable {
    let dailyDigestEnabled: Bool
}

private struct APIErrorEnvelope: Decodable {
    let ok: Bool
    let error: String
}
