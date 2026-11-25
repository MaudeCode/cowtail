import SwiftUI

/// What Hermes is doing: its heartbeat, platforms, cron jobs and incidents, kanban, budget,
/// the runbook and its runs, and the owner's recent answers. The server decides every level,
/// order and link.
struct HermesView: View {
    @Environment(CowtailStore.self) private var store
    @Environment(\.cowtailPalette) private var palette
    @State private var confirming: RunbookScript?

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
                    runbook(heartbeat.runbook)
                } else {
                    note("Hermes has not sent a heartbeat yet.")
                }
                runView(status.recentRuns)
                answers(status.recentAnswers)
            }
        }
        .polling { await store.refresh() }
        .task(id: store.shownRunID) {
            if let id = store.shownRunID {
                await store.followRun(id: id)
            }
        }
        .runbookConfirmation($confirming) { script in
            Task { await store.startRun(script) }
        }
    }

    /// One section per category. A script that asks to confirm says so and has a red Run
    /// button; a script's button waits while a run of it is queued or running.
    @ViewBuilder
    private func runbook(_ sections: [RunbookSection]) -> some View {
        ForEach(sections) { section in
            CowtailSectionHeader(title: "Runbook · \(section.category)")
            ForEach(section.scripts) { script in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(script.name).font(.cowtailSans(14, relativeTo: .body))
                        if script.asksToConfirm {
                            Text("Asks to confirm")
                                .font(.cowtailSans(12, relativeTo: .caption))
                                .foregroundStyle(palette.mutedInk)
                        }
                    }
                    Spacer()
                    CowtailIconButton(
                        title: "Run \(script.name)",
                        systemImage: "play.fill",
                        role: script.asksToConfirm ? .destructive : nil,
                        isBusy: store.runbook.scriptsStarting.contains(script.id)
                    ) {
                        if script.asksToConfirm {
                            confirming = script
                        } else {
                            Task { await store.startRun(script) }
                        }
                    }
                    .disabled(script.running)
                    .accessibilityIdentifier("button.runbook.\(script.id)")
                }
                .cowtailRow()
            }
        }
        if let error = store.runbook.error {
            note(error, tint: palette.accent)
        }
    }

    /// The run the owner started or picked, else the newest: its status and time, its output
    /// as it arrives, then the recent runs.
    @ViewBuilder
    private func runView(_ runs: [RunbookRun]) -> some View {
        let id = store.shownRunID
        let detail = store.runbook.detail?.run.id == id ? store.runbook.detail : nil
        if let run = detail?.run ?? runs.first(where: { $0.id == id }) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                CowtailSectionHeader(title: "Run · \(run.scriptName)") {
                    Text([run.status.rawValue, run.elapsed(now: context.date)].joined(separator: " · "))
                        .font(.cowtailMono(11, relativeTo: .caption))
                        .foregroundStyle(run.tint(palette))
                        .accessibilityIdentifier("text.run.status")
                }
            }
            Text(output(detail, run: run))
                .font(.cowtailMono(11, relativeTo: .caption))
                .foregroundStyle(palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(palette.surfaceRaised)
                .overlay(alignment: .leading) {
                    Rectangle().fill(palette.border).frame(width: 2)
                }
                .padding(.vertical, 8)
                .textSelection(.enabled)
                .accessibilityIdentifier("text.run.output")
            ForEach(runs) { entry in
                Button {
                    store.selectRun(entry.id)
                } label: {
                    HStack {
                        Text(entry.scriptName)
                            .font(.cowtailSans(14, weight: entry.id == id ? .medium : .regular, relativeTo: .body))
                            .lineLimit(1)
                        Spacer()
                        Text("\(Text(entry.result).foregroundStyle(entry.tint(palette))) · \(ItemFormat.when(entry.createdAt))")
                            .font(.cowtailMono(12, relativeTo: .caption))
                            .foregroundStyle(palette.mutedInk)
                    }
                    .cowtailRow()
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("row.hermes.run.\(entry.id)")
            }
        }
    }

    private func output(_ detail: RunbookRunDetail?, run: RunbookRun) -> String {
        if let output = detail?.output, !output.isEmpty {
            return output
        }
        return run.active ? "Waiting for output…" : "No output."
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
                tint: heartbeat.kanbanBlocked ? palette.warning : nil
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
                .font(.cowtailMono(11, relativeTo: .caption))
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
            CowtailRouteLink(value: AppRoute.item(itemID)) {
                HStack {
                    label
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(.subheadline, weight: .semibold))
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
