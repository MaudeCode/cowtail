import Foundation
import OpenAPIRuntime

/// Maps the generated wire types to the app's item model, and back for the owner's actions.
extension CowtailAPI {
    static func milliseconds(_ date: Date) -> Int {
        Int((date.timeIntervalSince1970 * 1000).rounded())
    }

    static func date(_ milliseconds: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
    }

    static func makeItem(_ record: Components.Schemas.ItemRecord) -> Item {
        Item(
            id: record.id,
            source: record.source,
            sourceName: record.sourceInfo.displayName,
            sourceIconURL: record.sourceInfo.iconUrl.flatMap(URL.init(string:)),
            kind: ItemKind(rawValue: record.kind.rawValue) ?? .fyi,
            urgency: ItemUrgency(rawValue: record.urgency.rawValue) ?? .whenever,
            state: ItemState(rawValue: record.state.rawValue) ?? .open,
            needsOwner: record.needsOwner,
            title: record.title,
            body: record.body,
            links: record.links.compactMap { link in
                URL(string: link.url).map { ItemLink(label: link.label, url: $0) }
            },
            context: record.context.additionalProperties,
            contextOrder: record.contextOrder,
            occurrenceCount: record.occurrenceCount,
            actions: record.actions.compactMap(makeAction),
            availableActions: (record.availableActions ?? []).compactMap(makeAction),
            alertID: record.alertId,
            alertActions: (record.alertActions ?? []).compactMap { AlertHumanAction(rawValue: $0.rawValue) },
            rootCause: record.investigationResult?.rootCause,
            actionTaken: record.investigationResult?.action,
            ownerNote: record.investigationResult?.ownerNote,
            approvalNeedsAuth: record.approvalNeedsAuth ?? false,
            expiresAt: record.expiresAt.map(date),
            createdAt: date(record.createdAt),
            updatedAt: date(record.updatedAt),
            resolvedAt: record.resolvedAt.map(date),
            subtitle: record.subtitle,
            latestUpdate: record.latestUpdate.map { ItemUpdate(text: $0.text, at: date($0.at)) },
            investigationStep: record.investigationStep.flatMap { .init(rawValue: $0.rawValue) },
            outcome: record.outcome.flatMap { .init(rawValue: $0.rawValue) },
            resolvedAfter: record.resolvedAfterMs.map { TimeInterval($0) / 1000 },
            createdDate: record.createdDate
        )
    }

    private static func makeAction(_ action: Components.Schemas.ItemAction) -> ItemAction? {
        switch action {
        case .case1: .approve
        case .case2: .deny
        case .case3(let choose): .choose(choose.options)
        case .case4: .reply
        case .case5: .snooze
        case .case6: .ack
        case .case7(let open): URL(string: open.url).map(ItemAction.open)
        }
    }

    static func makeEvent(_ record: Components.Schemas.ItemEventRecord) -> ItemEvent {
        ItemEvent(
            id: record.id,
            at: date(record.at),
            type: ItemEventType(rawValue: record._type.rawValue) ?? .notified,
            actor: record.actor,
            payload: record.payload.additionalProperties.compactMapValues { container in
                switch container?.value {
                case let text as String: text
                case let flag as Bool: flag ? "true" : "false"
                case let number as Int: String(number)
                case let number as Double: String(number)
                default: nil
                }
            },
            evidence: (record.evidence ?? []).map {
                EvidenceStep(step: $0.step, command: $0.command, output: $0.output)
            }
        )
    }

    static func makePriorOccurrence(_ record: Components.Schemas.PriorOccurrence) -> PriorOccurrence {
        PriorOccurrence(
            alertID: record.alertId,
            firedAt: date(record.firedAt),
            outcome: ItemOutcome(rawValue: record.outcome.rawValue) ?? .other,
            rootCause: record.rootCause,
            summary: record.summary,
            cause: record.cause,
            fixCommit: record.fixCommit,
            fixes: record.fixes.map {
                PriorOccurrence.Fix(description: $0.description, rootCause: $0.rootCause, commit: $0.commit)
            }
        )
    }

    static func makeStats(_ response: Components.Schemas.ItemStatsResponse) -> ItemStats {
        let mix = response.outcomeMix
        return ItemStats(
            from: date(response.from),
            createdCount: response.createdCount,
            resolvedCount: response.resolvedCount,
            outcomeMix: [
                .fixed: mix.fixed,
                .selfResolved: mix.selfResolved,
                .noise: mix.noise,
                .escalated: mix.escalated,
                .other: mix.other,
            ],
            noiseRate: response.noiseRate,
            timeToResolve: response.timeToResolve.compactMap { row in
                ItemKind(rawValue: row.kind.rawValue).map {
                    ItemStats.KindResolveTime(
                        kind: $0,
                        count: row.count,
                        median: TimeInterval(row.medianMs) / 1000,
                        p90: TimeInterval(row.p90Ms) / 1000
                    )
                }
            },
            repeatOffenders: response.repeatOffenders.map {
                ItemStats.RepeatOffender(
                    dedupeKey: $0.dedupeKey,
                    title: $0.title,
                    occurrenceCount: $0.occurrenceCount,
                    noiseShare: $0.noiseShare
                )
            },
            dailyVolume: response.dailyVolume.map {
                ItemStats.DailyVolume(date: $0.date, total: $0.total, bySource: $0.bySource.additionalProperties)
            },
            volumeSources: response.volumeSources ?? [],
            firingCount: response.firingCount,
            firingByNamespace: response.firingByNamespace.map {
                ItemStats.NamespaceCount(namespace: $0.namespace, count: $0.count)
            }
        )
    }

    static func makeActionRequest(_ request: ItemActionRequest) -> Components.Schemas.ItemActionRequest {
        switch request {
        case .ack:
            .case1(.init(_type: .ack))
        case .snooze(let until):
            .case2(.init(_type: .snooze, until: milliseconds(until)))
        case .approve:
            .case3(.init(_type: .approve))
        case .deny:
            .case4(.init(_type: .deny))
        case .choose(let option):
            .case5(.init(_type: .choose, option: option))
        case .reply(let text):
            .case6(.init(_type: .reply, text: text))
        }
    }

    static func makeHermesStatus(_ response: Components.Schemas.HermesStatusResponse) -> HermesStatus {
        HermesStatus(
            heartbeat: response.status.map { status in
                let snapshot = status.snapshot
                return HermesStatus.Heartbeat(
                    receivedAt: date(status.receivedAt),
                    level: status.statusLevel.flatMap { .init(rawValue: $0.rawValue) },
                    platforms: snapshot.platforms,
                    model: snapshot.model,
                    provider: snapshot.provider,
                    cronJobs: (status.cronJobs ?? []).map { job in
                        HermesStatus.CronJob(
                            id: job.id,
                            name: job.name,
                            schedule: job.schedule,
                            lastRunAt: job.lastRunAt.map(date),
                            lastStatus: job.lastStatus,
                            nextRunAt: job.nextRunAt.map(date),
                            failing: job.failing
                        )
                    },
                    cronJobCount: status.cronJobCount ?? 0,
                    failingCronCount: status.failingCronCount ?? 0,
                    incidents: (status.incidents ?? []).map { incident in
                        HermesStatus.Incident(
                            id: incident.id,
                            jobName: incident.jobName ?? incident.jobId,
                            state: incident.state,
                            failureType: incident.failureType,
                            firstSeenAt: incident.firstSeenAt.map(date),
                            error: incident.error,
                            itemID: incident.itemId,
                            itemTitle: incident.itemTitle
                        )
                    },
                    incidentCount: status.incidentCount ?? 0,
                    kanban: snapshot.kanban.map { HermesStatus.Kanban(blocked: $0.blocked, running: $0.running) },
                    kanbanBlocked: status.kanbanBlocked ?? false,
                    budget: limits(
                        snapshot.budget?.additionalProperties.mapValues { limitText($0?.value1, $0?.value2, $0?.value3) },
                        order: status.budgetOrder
                    ),
                    rateLimits: limits(
                        snapshot.rateLimits?.additionalProperties.mapValues { limitText($0?.value1, $0?.value2, $0?.value3) },
                        order: status.rateLimitOrder
                    )
                )
            },
            recentAnswers: (response.recentAnswers ?? []).map { answer in
                HermesStatus.Answer(
                    itemID: answer.itemId,
                    title: answer.title,
                    answer: makeAnswer(answer.answer),
                    answeredAt: date(answer.answeredAt)
                )
            }
        )
    }

    private static func makeAnswer(_ answer: Components.Schemas.HermesRecentAnswer.AnswerPayload) -> ItemActionRequest {
        switch answer {
        case .case1: .ack
        case .case2: .approve
        case .case3: .deny
        case .case4(let choose): .choose(choose.option)
        case .case5(let reply): .reply(reply.text)
        }
    }

    /// A budget or rate-limit value: text, a number or a flag.
    private static func limitText(_ text: String?, _ number: Double?, _ flag: Bool?) -> String {
        text ?? number?.formatted() ?? flag.map { $0 ? "yes" : "no" } ?? "–"
    }

    /// The server's order of Hermes's keys.
    private static func limits(_ values: [String: String]?, order: [String]?) -> [HermesStatus.Limit] {
        (order ?? []).map { HermesStatus.Limit(key: $0, value: values?[$0] ?? "–") }
    }
}
