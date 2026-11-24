import type { HermesStatusResponse, RunbookRunRecord } from "@maudecode/cowtail-protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  Heartbeat,
  modelLine,
  NO_HEARTBEAT,
  type Status,
} from "../components/dashboard/HermesSummary";
import { itemPath } from "../components/items/ItemRow";
import RunScriptButton from "../components/items/RunScriptButton";
import {
  Badge,
  DataTable,
  Empty,
  Icon,
  KeyValue,
  outputBlock,
  QueryError,
  Section,
} from "../components/ui";
import { formatAge, formatClock, formatElapsed, formatUntil, formatWhen } from "../lib/format";
import { answerResult, hermesLevelTone, runStatusTone, toneText } from "../lib/itemPresentation";
import { hermesStatusQuery, runbookRunQuery } from "../lib/queries";
import { useNow } from "../lib/useNow";

function Cron({ status, now }: { status: Status; now: number }) {
  const jobs = status.cronJobs ?? [];
  if (jobs.length === 0) return <Empty>Hermes has no cron jobs.</Empty>;
  return (
    <DataTable columns={["Job", "Schedule", "Last run", "Next"]}>
      {jobs.map((job) => (
        <tr key={job.id}>
          <td className="font-medium">{job.name}</td>
          <td className="font-mono text-[0.7rem] text-gray-600">{job.schedule}</td>
          <td className="whitespace-nowrap">
            {job.lastStatus && <Badge tone={job.failing ? "now" : "ok"}>{job.lastStatus}</Badge>}{" "}
            <span className="text-[0.7rem] text-gray-600">
              {job.lastRunAt === undefined ? "never" : `${formatAge(job.lastRunAt, now)} ago`}
            </span>
          </td>
          <td className="font-mono text-[0.7rem] whitespace-nowrap text-gray-600">
            {job.nextRunAt === undefined ? "–" : `in ${formatUntil(job.nextRunAt, now)}`}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

function Incidents({ status }: { status: Status }) {
  const incidents = status.incidents ?? [];
  if (incidents.length === 0) return <Empty>No open cron incidents.</Empty>;
  return incidents.map((incident) => (
    <KeyValue
      key={incident.id}
      label={
        <>
          {incident.jobName ?? incident.jobId} {incident.failureType ?? incident.state}
          {incident.firstSeenAt !== undefined && ` since ${formatClock(incident.firstSeenAt)}`}
          {incident.error && <div className="text-[0.7rem] text-gray-600">{incident.error}</div>}
        </>
      }
    >
      {incident.itemId && (
        <Link to={itemPath(incident.itemId)} className="flex items-center gap-1 hover:underline">
          {incident.itemTitle}
          <Icon name="chev" />
        </Link>
      )}
    </KeyValue>
  ));
}

function RecentAnswers({ reply, now }: { reply: HermesStatusResponse; now: number }) {
  const answers = reply.recentAnswers ?? [];
  if (answers.length === 0) return <Empty>No answers in the last 7 days.</Empty>;
  return (
    <DataTable columns={["Asked", "Answer", "When"]}>
      {answers.map((answer) => {
        const result = answerResult(answer.answer);
        return (
          <tr key={answer.itemId}>
            <td>
              <Link to={itemPath(answer.itemId)} className="hover:underline">
                {answer.title}
              </Link>
            </td>
            <td
              className={`${toneText[result.tone]} ${answer.answer.type === "reply" ? "" : "whitespace-nowrap"}`}
            >
              {result.label}
            </td>
            <td className="font-mono text-[0.7rem] whitespace-nowrap text-gray-600">
              {formatWhen(answer.answeredAt, now)}
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}

// Budget and rate limits are whatever keys Hermes reports, in the server's order.
function Limits({ values, order }: { values?: Record<string, unknown>; order?: string[] }) {
  return (order ?? []).map((key) => {
    const value = values?.[key];
    return (
      <KeyValue key={key} label={key}>
        <span className="font-mono">
          {value === null || value === undefined ? "–" : String(value)}
        </span>
      </KeyValue>
    );
  });
}

// One section per category, in the server's order. A script that asks to confirm says so and
// has a red Run button; a script's button waits while a run of it is queued or running.
function Runbook({ status, onStarted }: { status: Status; onStarted: (id: string) => void }) {
  return (status.runbook ?? []).map((section) => (
    <Section key={section.category} label={`Runbook · ${section.category}`}>
      {section.scripts.map((script) => (
        <KeyValue
          key={script.id}
          label={
            <>
              {script.name}
              {script.confirmText !== undefined && (
                <div className="text-[0.7rem] text-gray-600">Asks to confirm</div>
              )}
            </>
          }
        >
          <RunScriptButton
            script={script}
            disabled={script.running}
            onStarted={(run) => onStarted(run.id)}
          />
        </KeyValue>
      ))}
    </Section>
  ));
}

function runResult(run: RunbookRunRecord, now: number) {
  if (run.exitCode !== undefined) return `exit ${run.exitCode}`;
  const from = run.startedAt ?? run.createdAt;
  return `${run.status} · ${formatElapsed((run.finishedAt ?? now) - from)}`;
}

// The run the owner started or picked, newest first otherwise: its status and time, its output
// as it arrives, then the recent runs.
function RunView({
  runs,
  selected,
  onSelect,
}: {
  runs: RunbookRunRecord[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const id = selected ?? runs[0]?.id;
  const reply = useQuery({ ...runbookRunQuery(id ?? ""), enabled: id !== undefined });
  const client = useQueryClient();
  const run = reply.data?.run ?? runs.find((entry) => entry.id === id);
  const now = useNow(run?.active ? 1_000 : 15_000);
  const ended = run?.active === false;
  // A run that ends frees its script's button and moves into the recent runs.
  useEffect(() => {
    if (ended) void client.invalidateQueries({ queryKey: hermesStatusQuery.queryKey });
  }, [ended, client]);
  if (!run) return null;

  const from = run.startedAt ?? run.createdAt;
  return (
    <Section
      label={`Run · ${run.scriptName}`}
      detail={
        <span className={toneText[runStatusTone[run.status]]}>
          {run.status} · {formatElapsed((run.finishedAt ?? now) - from)}
          {run.exitCode !== undefined && ` · exit ${run.exitCode}`}
        </span>
      }
    >
      {reply.error && <QueryError error={reply.error} />}
      <pre aria-label="Run output" className={`my-2 ${outputBlock}`}>
        {reply.data?.output || (run.active ? "Waiting for output…" : "No output.")}
      </pre>
      {runs.map((entry) => (
        <KeyValue
          key={entry.id}
          label={
            <button
              type="button"
              aria-current={entry.id === id}
              className="cursor-pointer text-left hover:underline aria-[current=true]:font-medium"
              onClick={() => onSelect(entry.id)}
            >
              {entry.scriptName}
            </button>
          }
        >
          <span className={toneText[runStatusTone[entry.status]]}>{runResult(entry, now)}</span>·
          <span className="font-mono text-[0.7rem]">{formatWhen(entry.createdAt, now)}</span>
        </KeyValue>
      ))}
    </Section>
  );
}

function StatusSection({ status, now }: { status: Status | null; now: number }) {
  if (!status) {
    return (
      <Section label="Status">
        <Empty>{NO_HEARTBEAT}</Empty>
      </Section>
    );
  }
  const { snapshot } = status;
  return (
    <Section
      label="Status"
      detail={
        <span className={status.statusLevel ? toneText[hermesLevelTone[status.statusLevel]] : ""}>
          <Heartbeat status={status} now={now} />
        </span>
      }
    >
      <KeyValue label="Model">
        <span className="font-mono">{modelLine(status) || "–"}</span>
      </KeyValue>
      <KeyValue label="Platforms">
        {snapshot.platforms.length === 0
          ? "none"
          : snapshot.platforms.map((platform) => (
              <Badge key={platform} tone="ok">
                {platform}
              </Badge>
            ))}
      </KeyValue>
      {snapshot.kanban && (
        <KeyValue label="Kanban">
          <span className={status.kanbanBlocked ? "text-warn" : ""}>
            {snapshot.kanban.blocked} blocked
          </span>
          · {snapshot.kanban.running} running
        </KeyValue>
      )}
      <Limits values={snapshot.budget} order={status.budgetOrder} />
      <Limits values={snapshot.rateLimits} order={status.rateLimitOrder} />
    </Section>
  );
}

export default function Hermes() {
  const { data, error } = useQuery(hermesStatusQuery);
  const now = useNow();
  const status = data?.status ?? null;
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  return (
    <div className="grid gap-x-[30px] min-[960px]:grid-cols-[1.5fr_1fr]">
      <div>
        <Section
          label="Cron"
          detail={status?.cronJobCount === undefined ? undefined : `${status.cronJobCount} jobs`}
        >
          {error && <QueryError error={error} />}
          {status && <Cron status={status} now={now} />}
        </Section>
        <Section label="Cron incidents" detail={status?.incidentCount}>
          {status && <Incidents status={status} />}
        </Section>
        <Section label="Recent approvals and answers">
          {data && <RecentAnswers reply={data} now={now} />}
        </Section>
        <RunView runs={data?.recentRuns ?? []} selected={selectedRun} onSelect={setSelectedRun} />
      </div>
      <div>
        {data && <StatusSection status={status} now={now} />}
        {status && <Runbook status={status} onStarted={setSelectedRun} />}
      </div>
    </div>
  );
}
