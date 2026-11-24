import type { HermesStatusResponse } from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  Heartbeat,
  modelLine,
  NO_HEARTBEAT,
  type Status,
} from "../components/dashboard/HermesSummary";
import { itemPath } from "../components/items/ItemRow";
import { Badge, DataTable, Empty, Icon, KeyValue, QueryError, Section } from "../components/ui";
import { formatAge, formatClock, formatUntil, formatWhen } from "../lib/format";
import { answerResult, hermesLevelTone, toneText } from "../lib/itemPresentation";
import { hermesStatusQuery } from "../lib/queries";
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
      </div>
      <div>{data && <StatusSection status={status} now={now} />}</div>
    </div>
  );
}
