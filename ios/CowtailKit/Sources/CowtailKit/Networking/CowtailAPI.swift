import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession
import OSLog

protocol CowtailAPIClient: Sendable {
    func fetchHealthSummary() async throws -> HealthSummary
    func fetchInbox(sessionToken: String) async throws -> ItemInbox
    func fetchItems(_ query: ItemListQuery, sessionToken: String) async throws -> ItemPage
    /// Nil when the server has no such item.
    func fetchItem(id: String, sessionToken: String) async throws -> ItemDetail?
    /// Nil when the server has no graph for the item.
    func fetchItemGraph(itemID: String, range: ItemGraphRange, sessionToken: String) async throws -> ItemGraph?
    /// Stats for the query's start, source, kind and outcome; no start means the last 7 days.
    func fetchItemStats(_ query: ItemListQuery, sessionToken: String) async throws -> ItemStats
    func fetchItemSources(sessionToken: String) async throws -> [String]
    func fetchHermesStatus(sessionToken: String) async throws -> HermesStatus
    /// `authenticated` says, for an approve or deny, whether the owner passed Face ID.
    func performItemAction(
        itemID: String,
        request: ItemActionRequest,
        authenticated: Bool?,
        sessionToken: String
    ) async throws -> Item
    func performAlertAction(
        alertID: String,
        action: AlertHumanAction,
        note: String?,
        sessionToken: String
    ) async throws
    func fetchDevices(sessionToken: String) async throws -> [UserDevice]
    /// The snooze picker's presets, in picker order, for an IANA time zone.
    func fetchSnoozeOptions(timeZone: String, sessionToken: String) async throws -> [SnoozeOption]
    /// The running maintenance windows, the soonest end first, and the sources a new one can hold.
    func fetchMaintenanceWindows(sessionToken: String) async throws -> MaintenanceWindows
    func startMaintenanceWindow(_ request: MaintenanceWindowRequest, sessionToken: String) async throws -> MaintenanceWindow
    func endMaintenanceWindow(id: String, sessionToken: String) async throws -> MaintenanceWindow
    /// Asks Hermes to run a runbook script, for an item when `itemID` is set. `confirmed` says
    /// the owner accepted the script's prompt, `authenticated` that they passed Face ID.
    /// `requestID` names the tap: sent again, it returns the run it queued.
    func startRunbookRun(
        requestID: String,
        scriptID: String,
        itemID: String?,
        confirmed: Bool,
        authenticated: Bool?,
        sessionToken: String
    ) async throws -> RunbookRun
    func fetchRunbookRun(id: String, sessionToken: String) async throws -> RunbookRunDetail
    /// Nil when the server has no such incident.
    func fetchIncident(id: String, sessionToken: String) async throws -> IncidentDetail?
    /// The items the server says the owner can add to the incident.
    func fetchIncidentCandidates(id: String, sessionToken: String) async throws -> [Item]
    func changeIncident(id: String, change: IncidentChange, sessionToken: String) async throws -> IncidentDetail
}

/// Sign-in and sign-out, for Apple and the server's OIDC provider alike.
protocol AuthAPIClient: Sendable {
    func createAuthSession(identityToken: String) async throws -> AppAuthSession
    /// The OIDC provider's name, or nil when the server offers only Sign in with Apple.
    func fetchOIDCProviderName() async throws -> String?
    /// Trades the code from the OIDC callback and its PKCE verifier for a session.
    func redeemOIDCHandoff(code: String, verifier: String) async throws -> AppAuthSession
    /// Revokes the session on the server.
    func logout(sessionToken: String) async throws
}

actor CowtailAPI: CowtailAPIClient, AuthAPIClient {
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Cowtail",
        category: "network"
    )
    private let transport: any ClientTransport

    init(transport: any ClientTransport = CowtailAPI.makeTransport()) {
        self.transport = transport
    }

    private static func makeTransport() -> URLSessionTransport {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 30
        return URLSessionTransport(
            configuration: .init(session: URLSession(configuration: configuration))
        )
    }

    private var healthClient: Client {
        Client(
            serverURL: AppConfig.baseURL(for: AppConfig.healthSummaryURL, droppingLastPathComponents: 1),
            transport: transport
        )
    }

    /// A push route's client: the app session rides as the bearer.
    private func pushClient(for url: URL, credential: PushCredential) -> Client {
        var middlewares: [any ClientMiddleware] = []
        if case let .session(sessionToken) = credential {
            middlewares.append(AppSessionAuthorizationMiddleware(sessionToken: sessionToken))
        }
        return Client(
            serverURL: AppConfig.baseURL(for: url, droppingLastPathComponents: 2),
            transport: transport,
            middlewares: middlewares
        )
    }

    private var authClient: Client {
        Client(serverURL: AppConfig.alertAPIBaseURL, transport: transport)
    }

    private func sessionClient(sessionToken: String) -> Client {
        Client(
            serverURL: AppConfig.alertAPIBaseURL,
            transport: transport,
            middlewares: [AppSessionAuthorizationMiddleware(sessionToken: sessionToken)]
        )
    }

    /// The roundup's alerts: the owner's session reads them from `/api/alerts`.
    func fetchAlerts(from: Date, to: Date, sessionToken: String) async throws -> [AlertItem] {
        let query = Operations.ListAlerts.Input.Query(
            from: Self.milliseconds(from),
            to: Self.milliseconds(to)
        )
        switch try await sessionClient(sessionToken: sessionToken).listAlerts(query: query) {
        case .ok(let response):
            return try response.body.json.alerts
                .map(makeAlertItem)
                .sorted { $0.timestamp > $1.timestamp }
        case .badRequest(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Alert list request failed with HTTP \(statusCode).")
        }
    }

    /// The roundup's fixes: the owner's session reads them from `/api/fixes`.
    func fetchFixes(from: Date, to: Date, sessionToken: String) async throws -> [AlertFix] {
        let query = Operations.ListFixes.Input.Query(
            from: Self.milliseconds(from),
            to: Self.milliseconds(to)
        )
        switch try await sessionClient(sessionToken: sessionToken).listFixes(query: query) {
        case .ok(let response):
            return try response.body.json.fixes
                .map(Self.makeAlertFix)
                .sorted { $0.timestamp > $1.timestamp }
        case .badRequest(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Fix list request failed with HTTP \(statusCode).")
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
            let body = await redactedResponseBodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Health request failed with status \(statusCode): \(body)")
        }
    }

    func registerPushDevice(
        credential: PushCredential,
        deviceToken: String,
        environment: String,
        deviceName: String
    ) async throws -> PushRegistrationResponse {
        guard let pushEnvironment = Components.Schemas.PushRegisterRequest.EnvironmentPayload(rawValue: environment) else {
            throw CowtailAPIError.requestFailed("Invalid APNS environment: \(environment)")
        }

        let output = try await pushClient(for: AppConfig.pushRegistrationURL, credential: credential).registerPushDevice(
            body: .json(
                .init(
                    identityToken: credential.identityToken,
                    deviceToken: deviceToken,
                    platform: "ios",
                    environment: pushEnvironment,
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
            let body = await responseBodyString(from: payload.body)
            throw CowtailAPIError.requestFailed("Push registration failed with status \(statusCode): \(body)")
        }
    }

    func unregisterPushDevice(
        credential: PushCredential,
        deviceToken: String
    ) async throws -> PushUnregistrationResponse {
        let output = try await pushClient(for: AppConfig.pushUnregistrationURL, credential: credential).unregisterPushDevice(
            body: .json(.init(identityToken: credential.identityToken, deviceToken: deviceToken))
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
            let body = await responseBodyString(from: payload.body)
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

    func fetchOIDCProviderName() async throws -> String? {
        switch try await authClient.getAuthProviders() {
        case .ok(let response):
            return try response.body.json.oidc?.name
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Sign-in options request failed with HTTP \(statusCode).")
        }
    }

    func redeemOIDCHandoff(code: String, verifier: String) async throws -> AppAuthSession {
        switch try await authClient.redeemOidcHandoff(body: .json(.init(code: code, verifier: verifier))) {
        case .ok(let response):
            let session = try response.body.json.session
            return AppAuthSession(
                token: session.token,
                userID: session.userId,
                expiresAt: Date(timeIntervalSince1970: TimeInterval(session.expiresAt) / 1000)
            )
        case .badRequest(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .notFound(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Sign-in failed with HTTP \(statusCode).")
        }
    }

    func logout(sessionToken: String) async throws {
        switch try await sessionClient(sessionToken: sessionToken).logout() {
        case .ok:
            return
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Sign-out failed with HTTP \(statusCode).")
        }
    }

    func fetchNotificationPreferences(sessionToken: String) async throws -> AppNotificationPreferences {
        let response: NotificationPreferencesResponse = try await sendJSONRequest(
            url: AppConfig.notificationPreferencesURL,
            method: "GET",
            bearerToken: sessionToken
        )

        return AppNotificationPreferences(response)
    }

    func updateNotificationPreferences(
        sessionToken: String,
        change: NotificationPreferencesChange
    ) async throws -> AppNotificationPreferences {
        let response: NotificationPreferencesResponse = try await sendJSONRequest(
            url: AppConfig.notificationPreferencesURL,
            method: "PUT",
            body: change,
            bearerToken: sessionToken
        )

        return AppNotificationPreferences(response)
    }

    func fetchInbox(sessionToken: String) async throws -> ItemInbox {
        switch try await sessionClient(sessionToken: sessionToken).getItemInbox() {
        case .ok(let response):
            let inbox = try response.body.json
            return ItemInbox(
                counts: ItemInbox.Counts(
                    needsYou: inbox.counts.needsYou,
                    withHermes: inbox.counts.withHermes,
                    // Absent from a server that predates Upcoming.
                    upcoming: inbox.counts.upcoming ?? 0
                ),
                needsYou: inbox.needsYou.map(Self.makeItem),
                withHermes: inbox.withHermes.map(Self.makeItem),
                upcoming: (inbox.upcoming ?? []).map(Self.makeItem),
                badge: inbox.badge,
                liveItemIDs: Set(inbox.liveItemIds)
            )
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Inbox request failed with HTTP \(statusCode).")
        }
    }

    func fetchItems(_ query: ItemListQuery, sessionToken: String) async throws -> ItemPage {
        let input = Operations.ListItems.Input.Query(
            source: query.source,
            kind: query.kind.flatMap { .init(rawValue: $0.rawValue) },
            outcome: query.outcome.flatMap { .init(rawValue: $0.rawValue) },
            alertId: query.alertID,
            q: query.search,
            range: query.range.flatMap { .init(rawValue: $0.rawValue) },
            from: query.from.map(Self.milliseconds),
            to: query.to.map(Self.milliseconds),
            limit: query.limit,
            cursor: query.cursor
        )
        switch try await sessionClient(sessionToken: sessionToken).listItems(query: input) {
        case .ok(let response):
            let page = try response.body.json
            return ItemPage(
                items: page.items.map(Self.makeItem),
                nextCursor: page.nextCursor,
                days: (page.days ?? []).map { ItemPage.Day(date: $0.date, count: $0.count) },
                from: page.from.map(Self.date)
            )
        case .badRequest(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Item list request failed with HTTP \(statusCode).")
        }
    }

    func fetchItem(id: String, sessionToken: String) async throws -> ItemDetail? {
        switch try await sessionClient(sessionToken: sessionToken).getItem(path: .init(id: id)) {
        case .ok(let response):
            let detail = try response.body.json
            return ItemDetail(
                item: Self.makeItem(detail.item),
                events: detail.events.map(Self.makeEvent),
                fixes: (detail.fixes ?? []).map(Self.makeAlertFix),
                priorOccurrences: (detail.priorOccurrences ?? []).map(Self.makePriorOccurrence)
            )
        case .notFound:
            return nil
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Item request failed with HTTP \(statusCode).")
        }
    }

    func fetchItemGraph(itemID: String, range: ItemGraphRange, sessionToken: String) async throws -> ItemGraph? {
        let response = try await sessionClient(sessionToken: sessionToken).getItemGraph(
            path: .init(id: itemID),
            query: .init(range: .init(rawValue: range.rawValue))
        )
        switch response {
        case .ok(let response):
            return Self.makeGraph(try response.body.json)
        case .notFound:
            return nil
        case .badRequest(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Graph request failed with HTTP \(statusCode).")
        }
    }

    func fetchItemStats(_ scope: ItemListQuery, sessionToken: String) async throws -> ItemStats {
        let query = Operations.GetItemStats.Input.Query(
            range: scope.range.flatMap { .init(rawValue: $0.rawValue) },
            from: scope.from.map(Self.milliseconds),
            to: scope.to.map(Self.milliseconds),
            source: scope.source,
            kind: scope.kind.flatMap { .init(rawValue: $0.rawValue) },
            outcome: scope.outcome.flatMap { .init(rawValue: $0.rawValue) }
        )
        switch try await sessionClient(sessionToken: sessionToken).getItemStats(query: query) {
        case .ok(let response):
            return Self.makeStats(try response.body.json)
        case .badRequest(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Stats request failed with HTTP \(statusCode).")
        }
    }

    func fetchItemSources(sessionToken: String) async throws -> [String] {
        switch try await sessionClient(sessionToken: sessionToken).listItemSources() {
        case .ok(let response):
            return try response.body.json.sources
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Source list request failed with HTTP \(statusCode).")
        }
    }

    func fetchHermesStatus(sessionToken: String) async throws -> HermesStatus {
        switch try await sessionClient(sessionToken: sessionToken).getHermesStatus() {
        case .ok(let response):
            return Self.makeHermesStatus(try response.body.json)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Hermes status request failed with HTTP \(statusCode).")
        }
    }

    func fetchSnoozeOptions(timeZone: String, sessionToken: String) async throws -> [SnoozeOption] {
        switch try await sessionClient(sessionToken: sessionToken).getSnoozeOptions(query: .init(timeZone: timeZone)) {
        case .ok(let response):
            return try response.body.json.options.compactMap { option in
                SnoozeOption.Preset(rawValue: option.preset.rawValue).map {
                    SnoozeOption(preset: $0, until: Self.date(option.until))
                }
            }
        case .badRequest(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Snooze options request failed with HTTP \(statusCode).")
        }
    }

    func fetchMaintenanceWindows(sessionToken: String) async throws -> MaintenanceWindows {
        switch try await sessionClient(sessionToken: sessionToken).listMaintenanceWindows() {
        case .ok(let response):
            let list = try response.body.json
            return MaintenanceWindows(
                active: list.active.map(Self.makeMaintenanceWindow),
                sourceChoices: list.sourceChoices
            )
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Maintenance window request failed with HTTP \(statusCode).")
        }
    }

    func startMaintenanceWindow(
        _ request: MaintenanceWindowRequest,
        sessionToken: String
    ) async throws -> MaintenanceWindow {
        let body = Components.Schemas.MaintenanceWindowStartRequest(
            title: request.title,
            durationMs: Int((request.duration * 1000).rounded()),
            matchers: request.matchers.map { .init(label: $0.label, value: $0.value) },
            sources: request.sources,
            requestId: request.requestID.uuidString.lowercased()
        )
        switch try await sessionClient(sessionToken: sessionToken).startMaintenanceWindow(body: .json(body)) {
        case .ok(let response):
            return Self.makeMaintenanceWindow(try response.body.json.window)
        case .badRequest(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Starting the window failed with HTTP \(statusCode).")
        }
    }

    func endMaintenanceWindow(id: String, sessionToken: String) async throws -> MaintenanceWindow {
        switch try await sessionClient(sessionToken: sessionToken).endMaintenanceWindow(path: .init(id: id)) {
        case .ok(let response):
            return Self.makeMaintenanceWindow(try response.body.json.window)
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .notFound(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Ending the window failed with HTTP \(statusCode).")
        }
    }

    func fetchIncident(id: String, sessionToken: String) async throws -> IncidentDetail? {
        switch try await sessionClient(sessionToken: sessionToken).getIncident(path: .init(id: id)) {
        case .ok(let response):
            return Self.makeIncidentDetail(try response.body.json)
        case .notFound:
            return nil
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Incident request failed with HTTP \(statusCode).")
        }
    }

    func fetchIncidentCandidates(id: String, sessionToken: String) async throws -> [Item] {
        switch try await sessionClient(sessionToken: sessionToken).listIncidentCandidates(path: .init(id: id)) {
        case .ok(let response):
            return try response.body.json.items.map(Self.makeItem)
        case .notFound(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Listing items to add failed with HTTP \(statusCode).")
        }
    }

    /// A 4xx is the server turning the change down: nothing changed.
    func changeIncident(id: String, change: IncidentChange, sessionToken: String) async throws -> IncidentDetail {
        let client = sessionClient(sessionToken: sessionToken)
        let failed = { (statusCode: Int) in
            CowtailAPIError.requestFailed("Changing the incident failed with HTTP \(statusCode).")
        }
        switch change {
        case .add(let itemID):
            switch try await client.addIncidentItem(path: .init(id: id), body: .json(.init(itemId: itemID))) {
            case .ok(let response): return Self.makeIncidentDetail(try response.body.json)
            case .unauthorized(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .forbidden(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .notFound(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .conflict(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .undocumented(let statusCode, _): throw failed(statusCode)
            }
        case .remove(let itemID):
            switch try await client.removeIncidentItem(path: .init(id: id, itemId: itemID)) {
            case .ok(let response): return Self.makeIncidentDetail(try response.body.json)
            case .unauthorized(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .forbidden(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .notFound(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .undocumented(let statusCode, _): throw failed(statusCode)
            }
        case .resolve:
            switch try await client.resolveIncident(path: .init(id: id)) {
            case .ok(let response): return Self.makeIncidentDetail(try response.body.json)
            case .unauthorized(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .forbidden(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .notFound(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .undocumented(let statusCode, _): throw failed(statusCode)
            }
        case .requestPostmortem:
            switch try await client.requestIncidentPostmortem(path: .init(id: id)) {
            case .ok(let response): return Self.makeIncidentDetail(try response.body.json)
            case .unauthorized(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .forbidden(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .notFound(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .conflict(let response): throw CowtailAPIError.refused(try response.body.json.error)
            case .undocumented(let statusCode, _): throw failed(statusCode)
            }
        }
    }

    func startRunbookRun(
        requestID: String,
        scriptID: String,
        itemID: String?,
        confirmed: Bool,
        authenticated: Bool?,
        sessionToken: String
    ) async throws -> RunbookRun {
        let body = Components.Schemas.RunbookRunRequest(
            requestId: requestID,
            scriptId: scriptID,
            itemId: itemID,
            confirmed: confirmed,
            authenticated: authenticated
        )
        switch try await sessionClient(sessionToken: sessionToken).startRunbookRun(.init(body: .json(body))) {
        case .ok(let response):
            return Self.makeRunbookRun(try response.body.json.run)
        case .badRequest(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .notFound(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Run request failed with HTTP \(statusCode).")
        }
    }

    func fetchRunbookRun(id: String, sessionToken: String) async throws -> RunbookRunDetail {
        switch try await sessionClient(sessionToken: sessionToken).getRunbookRun(.init(path: .init(id: id))) {
        case .ok(let response):
            let reply = try response.body.json
            return RunbookRunDetail(run: Self.makeRunbookRun(reply.run), output: reply.output)
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .notFound(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Run request failed with HTTP \(statusCode).")
        }
    }

    func fetchDevices(sessionToken: String) async throws -> [UserDevice] {
        switch try await sessionClient(sessionToken: sessionToken).listMyDevices() {
        case .ok(let response):
            return try response.body.json.devices.map {
                UserDevice(
                    id: $0.id,
                    name: $0.deviceName ?? $0.platform,
                    lastSeenAt: Self.date($0.lastSeenAt)
                )
            }
        case .unauthorized(let response):
            throw CowtailAPIError.requestFailed(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Device list request failed with HTTP \(statusCode).")
        }
    }

    /// Acks, snoozes or answers an item, as the owner.
    func performItemAction(
        itemID: String,
        request: ItemActionRequest,
        authenticated: Bool?,
        sessionToken: String
    ) async throws -> Item {
        let output = try await sessionClient(sessionToken: sessionToken).performItemAction(
            .init(
                path: .init(id: itemID),
                query: .init(authenticated: authenticated),
                body: .json(Self.makeActionRequest(request))
            )
        )

        switch output {
        case .ok(let response):
            return Self.makeItem(try response.body.json.item)
        case .badRequest(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .notFound(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .conflict(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Request failed with HTTP \(statusCode).")
        }
    }

    func performAlertAction(
        alertID: String,
        action: AlertHumanAction,
        note: String?,
        sessionToken: String
    ) async throws {
        let generatedAction: AlertHumanActionRequest.ActionPayload = switch action {
        case .retryInvestigation: .retryInvestigation
        case .markNoise: .markNoise
        case .escalate: .escalate
        }
        let output = try await sessionClient(sessionToken: sessionToken).performAlertAction(
            .init(
                path: .init(id: alertID),
                body: .json(AlertHumanActionRequest(action: generatedAction, note: note))
            )
        )

        switch output {
        case .ok:
            return
        case .badRequest(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .unauthorized(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .forbidden(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .notFound(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .conflict(let response):
            throw CowtailAPIError.refused(try response.body.json.error)
        case .undocumented(let statusCode, _):
            throw CowtailAPIError.requestFailed("Request failed with HTTP \(statusCode).")
        }
    }

    private func makeAlertItem(_ record: Components.Schemas.AlertRecord) -> AlertItem {
        AlertItem(
            id: record.id,
            timestamp: Self.date(record.timestamp),
            alertName: record.alertname,
            severity: AlertSeverity(rawValue: record.severity) ?? .unknown,
            namespace: record.namespace,
            node: record.node ?? "",
            outcome: AlertOutcome(rawValue: record.outcome.rawValue) ?? .unknown,
            summary: record.summary,
            rootCause: record.rootCause ?? "",
            actionTaken: record.action,
            status: AlertLifecycleStatus(rawValue: record.status.rawValue) ?? .unknown,
            resolvedAt: record.resolvedAt.map(Self.date),
            messaged: record.messaged,
            investigation: record.investigation.map {
                makeInvestigation(
                    id: $0.id,
                    status: $0.status.rawValue,
                    priority: $0.priority.rawValue,
                    attempts: $0.attempts,
                    maxAttempts: $0.maxAttempts,
                    nextAttemptAt: $0.nextAttemptAt,
                    claimedAt: $0.claimedAt,
                    leaseUntil: $0.leaseUntil,
                    lastError: $0.lastError,
                    lastErrorPhase: $0.lastErrorPhase,
                    completedAt: $0.completedAt,
                    deadletteredAt: $0.deadletteredAt,
                    updatedAt: $0.updatedAt
                )
            },
            ownerDisposition: record.ownerDisposition.flatMap { AlertOwnerDisposition(rawValue: $0.rawValue) },
            ownerNote: record.ownerNote ?? "",
            ownerUpdatedAt: record.ownerUpdatedAt.map(millisecondsToDate)
        )
    }

    private func makeInvestigation(
        id: String,
        status: String,
        priority: String,
        attempts: Int,
        maxAttempts: Int,
        nextAttemptAt: Int,
        claimedAt: Int?,
        leaseUntil: Int?,
        lastError: String?,
        lastErrorPhase: String?,
        completedAt: Int?,
        deadletteredAt: Int?,
        updatedAt: Int
    ) -> AlertInvestigation {
        AlertInvestigation(
            id: id,
            status: AlertInvestigationStatus(rawValue: status) ?? .failed,
            priority: AlertInvestigationPriority(rawValue: priority) ?? .normal,
            attempts: attempts,
            maxAttempts: maxAttempts,
            nextAttemptAt: millisecondsToDate(nextAttemptAt),
            claimedAt: claimedAt.map(millisecondsToDate),
            leaseUntil: leaseUntil.map(millisecondsToDate),
            lastError: lastError ?? "",
            lastErrorPhase: lastErrorPhase ?? "",
            completedAt: completedAt.map(millisecondsToDate),
            deadletteredAt: deadletteredAt.map(millisecondsToDate),
            updatedAt: millisecondsToDate(updatedAt)
        )
    }

    private func millisecondsToDate<T: BinaryInteger>(_ value: T) -> Date {
        Date(timeIntervalSince1970: TimeInterval(value) / 1000)
    }

    private func millisecondsToDate(_ value: Double) -> Date {
        Date(timeIntervalSince1970: value / 1000)
    }

    static func makeAlertFix(_ record: Components.Schemas.FixRecord) -> AlertFix {
        AlertFix(
            id: record.id,
            description: record.description,
            rootCause: record.rootCause,
            scope: FixScope(rawValue: record.scope.rawValue) ?? .unknown,
            timestamp: date(record.timestamp)
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
            storageUnit: payload.storageUnit,
            pipelineState: payload.alertPipeline.flatMap { .init(rawValue: $0.state.rawValue) },
            lastWatchdogAt: payload.alertPipeline?.lastWatchdogAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        )
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
            let detail = (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?.error
                ?? (body.isEmpty ? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode) : body)
            let message = "Request failed with status \(httpResponse.statusCode): \(detail)"
            // A 4xx means the server turned the request down; a 5xx leaves the outcome unknown.
            throw (400..<500).contains(httpResponse.statusCode)
                ? CowtailAPIError.refused(message)
                : CowtailAPIError.requestFailed(message)
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
        let body = await redactedResponseBodyString(from: payload.body)
        logger.error(
            "\(operation, privacy: .public) undocumented response status=\(statusCode, privacy: .public) headers=<redacted> body=\(body, privacy: .public)"
        )
    }

    static func responseBodyString(from body: HTTPBody?) async -> String {
        await readableResponseBody(from: body).unredactedDescription
    }

    private func responseBodyString(from body: HTTPBody?) async -> String {
        await Self.responseBodyString(from: body)
    }

    private func redactedResponseBodyString(from body: HTTPBody?) async -> String {
        await Self.readableResponseBody(from: body).redactedDescription
    }

    private static func readableResponseBody(from body: HTTPBody?) async -> ReadableResponseBody {
        guard let body else {
            return .empty
        }

        do {
            let bytes = try await Array(collecting: body, upTo: 32_768)
            return .bytes(bytes)
        } catch {
            return .unreadable
        }
    }

    private enum ReadableResponseBody {
        case empty
        case bytes([UInt8])
        case unreadable

        var unredactedDescription: String {
            switch self {
            case .empty:
                return "<empty>"
            case .bytes(let bytes):
                return String(decoding: bytes, as: UTF8.self)
            case .unreadable:
                return "<unreadable response body>"
            }
        }

        var redactedDescription: String {
            switch self {
            case .empty:
                return "<empty>"
            case .bytes(let bytes):
                return "<redacted response body: \(bytes.count) bytes>"
            case .unreadable:
                return "<unreadable redacted response body>"
            }
        }
    }
}

enum CowtailAPIError: LocalizedError {
    case requestFailed(String)
    /// The server answered and turned the request down; nothing changed.
    case refused(String)

    var errorDescription: String? {
        switch self {
        case .requestFailed(let body), .refused(let body):
            return body
        }
    }
}

struct AppSessionAuthorizationMiddleware: ClientMiddleware {
    let sessionToken: String

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[.authorization] = "Bearer \(sessionToken)"
        return try await next(request, body, baseURL)
    }
}

/// How a push route learns the device's user: the app session, or an Apple identity token
/// when there is no session.
enum PushCredential: Sendable {
    case session(String)
    case appleIdentity(String)

    var identityToken: String? {
        if case let .appleIdentity(identityToken) = self {
            return identityToken
        }
        return nil
    }
}

typealias PushRegistrationResponse = Components.Schemas.PushRegisterResponse
typealias PushUnregistrationResponse = Components.Schemas.PushUnregisterResponse
typealias AuthSessionCreateRequest = Components.Schemas.AuthSessionCreateRequest
typealias AuthSessionCreateResponse = Components.Schemas.AuthSessionCreateResponse
typealias NotificationPreferencesResponse = Components.Schemas.NotificationPreferencesResponse
typealias NotificationPreferencesUpdateRequest = Components.Schemas.NotificationPreferencesUpdateRequest
typealias AlertHumanActionRequest = Components.Schemas.AlertHumanActionRequest
typealias AlertHumanActionResponse = Components.Schemas.AlertHumanActionResponse

struct AppAuthSession: Sendable {
    let token: String
    let userID: String
    let expiresAt: Date
}

struct QuietHours: Equatable, Sendable {
    /// `HH:MM`, in `timeZone`.
    var start: String
    var end: String
    var timeZone: String
}

struct AppNotificationPreferences: Equatable, Sendable {
    var dailyRoundupEnabled: Bool
    var requireAuthForApprovals: Bool
    var quietHours: QuietHours?
    var urgencyOverrides: [String: ItemUrgency]
    /// The override keys in the server's order.
    var urgencyOverrideOrder: [String]

    init(
        dailyRoundupEnabled: Bool = false,
        requireAuthForApprovals: Bool = false,
        quietHours: QuietHours? = nil,
        urgencyOverrides: [String: ItemUrgency] = [:],
        urgencyOverrideOrder: [String]? = nil
    ) {
        self.dailyRoundupEnabled = dailyRoundupEnabled
        self.requireAuthForApprovals = requireAuthForApprovals
        self.quietHours = quietHours
        self.urgencyOverrides = urgencyOverrides
        self.urgencyOverrideOrder = urgencyOverrideOrder ?? Array(urgencyOverrides.keys)
    }

    init(_ response: NotificationPreferencesResponse) {
        let preferences = response.preferences
        dailyRoundupEnabled = preferences.dailyRoundupEnabled
        requireAuthForApprovals = preferences.requireAuthForApprovals
        quietHours = preferences.quietHours.map {
            QuietHours(start: $0.start, end: $0.end, timeZone: $0.timeZone)
        }
        urgencyOverrides = preferences.urgencyOverrides.additionalProperties.compactMapValues {
            ItemUrgency(rawValue: $0.rawValue)
        }
        urgencyOverrideOrder = response.urgencyOverrideOrder ?? Array(urgencyOverrides.keys)
    }
}

/// One settings change. Fields left nil keep their stored value; `quietHoursOff` sends
/// `quietHours: null`, which the generated request type cannot express.
struct NotificationPreferencesChange: Encodable, Sendable {
    var request = NotificationPreferencesUpdateRequest()
    var quietHoursOff = false

    func encode(to encoder: any Encoder) throws {
        try request.encode(to: encoder)
        if quietHoursOff {
            var container = encoder.container(keyedBy: QuietHoursKey.self)
            try container.encodeNil(forKey: .quietHours)
        }
    }

    private enum QuietHoursKey: String, CodingKey {
        case quietHours
    }
}

private struct APIErrorEnvelope: Decodable {
    let ok: Bool
    let error: String
}
