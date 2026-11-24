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
            occurrenceCount: record.occurrenceCount,
            actions: record.actions.compactMap(makeAction),
            alertID: record.alertId,
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

    private static func makeAction(_ action: Components.Schemas.ItemRecord.ActionsPayloadPayload) -> ItemAction? {
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
            }
        )
    }

    static func makeStats(_ response: Components.Schemas.ItemStatsResponse) -> ItemStats {
        let mix = response.outcomeMix
        return ItemStats(
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
}
