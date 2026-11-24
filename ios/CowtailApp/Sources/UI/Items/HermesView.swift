import SwiftUI

/// What Hermes is doing: its heartbeat, platforms, cron jobs and incidents, kanban, budget,
/// and the owner's recent answers. The server decides every level, order and link.
struct HermesView: View {
    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        CowtailScreen(title: "Hermes", identifier: "screen.hermes") {
            if let heartbeat = store.hermes?.heartbeat {
                let age = ItemFormat.age(of: heartbeat.receivedAt)
                CowtailStatusBadge(title: "\(age) ago", tint: heartbeat.level?.tint(palette), showsDot: true)
                    .accessibilityLabel("Last heartbeat \(age) ago")
                    .accessibilityIdentifier("chip.hermes.heartbeat")
            }
        } content: {
            if let error = store.hermesErrorMessage {
                note(error, tint: palette.accent)
            }
            if let status = store.hermes {
                if let heartbeat = status.heartbeat {
                    sections(heartbeat)
                } else {
                    note("Hermes has not sent a heartbeat yet.")
                }
                answers(status.recentAnswers)
            }
        }
        .polling { await store.refresh() }
    }

    @ViewBuilder
    private func sections(_ heartbeat: HermesStatus.Heartbeat) -> some View {
        Text([heartbeat.model, heartbeat.provider].compactMap(\.self).joined(separator: " · "))
            .font(.cowtailMono(12, relativeTo: .caption))
            .foregroundStyle(palette.mutedInk)
            .padding(.top, 4)
            .accessibilityIdentifier("text.hermes.model")

        CowtailSectionHeader(title: "Platforms")
        FlowLayout(spacing: 6) {
            ForEach(heartbeat.platforms, id: \.self) { platform in
                CowtailStatusBadge(title: platform, tint: palette.success)
            }
        }
        .padding(.vertical, 8)

        CowtailSectionHeader(title: "Cron", detail: "\(heartbeat.cronJobCount) jobs")
        ForEach(heartbeat.cronJobs) { job in
            cronRow(job)
        }

        CowtailSectionHeader(title: "Cron incidents", detail: "\(heartbeat.incidentCount)")
        if heartbeat.incidents.isEmpty {
            note("No open cron incidents.")
        }
        ForEach(heartbeat.incidents) { incident in
            incidentRow(incident)
        }

        CowtailSectionHeader(title: "Kanban")
        if let kanban = heartbeat.kanban {
            CowtailKeyValueRow(
                key: "Blocked",
                value: "\(kanban.blocked)",
                tint: kanban.blocked > 0 ? palette.warning : nil
            )
            CowtailKeyValueRow(key: "Running", value: "\(kanban.running)")
        } else {
            note("Hermes reports no kanban board.")
        }

        CowtailSectionHeader(title: "Budget")
        if heartbeat.budget.isEmpty && heartbeat.rateLimits.isEmpty {
            note("Hermes reports no budget or rate limits.")
        }
        ForEach(heartbeat.budget + heartbeat.rateLimits, id: \.self) { limit in
            CowtailKeyValueRow(key: limit.key, value: limit.value)
        }
    }

    private func cronRow(_ job: HermesStatus.CronJob) -> some View {
        let lastRun = job.lastRunAt.map { "ran \(ItemFormat.age(of: $0)) ago" } ?? "never ran"
        let nextRun = job.nextRunAt.map { "next in \(ItemFormat.age(of: .now, now: $0))" }
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(job.name).font(.cowtailSans(14, weight: .medium, relativeTo: .body))
                if let status = job.lastStatus {
                    CowtailStatusBadge(title: status, tint: job.failing ? palette.accent : palette.success)
                }
            }
            Text([job.schedule, lastRun, nextRun].compactMap(\.self).joined(separator: " · "))
                .font(.cowtailMono(11, relativeTo: .caption2))
                .foregroundStyle(palette.mutedInk)
        }
        .cowtailRow()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("row.hermes.cron.\(job.id)")
    }

    @ViewBuilder
    private func incidentRow(_ incident: HermesStatus.Incident) -> some View {
        let label = VStack(alignment: .leading, spacing: 3) {
            Text("\(incident.jobName) \(incident.failureType ?? incident.state)")
                .font(.cowtailSans(14, relativeTo: .body))
            if let title = incident.itemTitle {
                Text(title)
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
            }
        }
        if let itemID = incident.itemID {
            NavigationLink(value: AppRoute.item(itemID)) {
                HStack {
                    label
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.mutedInk)
                }
                .cowtailRow()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("row.hermes.incident.\(incident.id)")
        } else {
            label.cowtailRow()
        }
    }

    @ViewBuilder
    private func answers(_ answers: [HermesStatus.Answer]) -> some View {
        CowtailSectionHeader(title: "Recent answers")
        if answers.isEmpty {
            note("No answers in the last 7 days.")
        }
        ForEach(answers) { answer in
            CowtailKeyValueRow(
                key: answer.title,
                value: "\(answer.answer.answerLabel) · \(ItemFormat.when(answer.answeredAt))",
                tint: answer.answer.answerTint(palette)
            )
            .accessibilityIdentifier("row.hermes.answer.\(answer.itemID)")
        }
    }

    private func note(_ text: String, tint: Color? = nil) -> some View {
        Text(text)
            .font(.cowtailSans(13, relativeTo: .footnote))
            .foregroundStyle(tint ?? palette.mutedInk)
            .padding(.vertical, 8)
    }
}
