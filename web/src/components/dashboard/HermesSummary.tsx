import type { HermesStatusResponse } from "@maudecode/cowtail-protocol";

import { formatAge } from "../../lib/format";
import { hermesLevelTone } from "../../lib/itemPresentation";
import { Empty, KeyValue, Section, StatusDot } from "../ui";

export type Status = NonNullable<HermesStatusResponse["status"]>;

export const NO_HEARTBEAT = "Hermes has not sent a heartbeat yet.";

// The status dot and how long ago Hermes last reported.
export function Heartbeat({ status, now }: { status: Status; now: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {status.statusLevel && <StatusDot tone={hermesLevelTone[status.statusLevel]} />}
      Heartbeat {formatAge(status.receivedAt, now)} ago
    </span>
  );
}

export function modelLine({ snapshot }: Status) {
  return [snapshot.model, snapshot.provider].filter(Boolean).join(" · ");
}

// Home's two rows: the heartbeat with the model, then the cron jobs.
export default function HermesSummary({
  reply,
  now,
}: {
  reply: HermesStatusResponse;
  now: number;
}) {
  const status = reply.status;
  if (!status) {
    return (
      <Section label="Hermes">
        <Empty>{NO_HEARTBEAT}</Empty>
      </Section>
    );
  }
  const failing = status.failingCronCount ?? 0;
  return (
    <Section label="Hermes">
      <KeyValue label={<Heartbeat status={status} now={now} />}>
        <span className="font-mono">{modelLine(status)}</span>
      </KeyValue>
      <KeyValue label="Cron">
        {failing > 0 && <span className="text-accent-text">{failing} failing ·</span>}
        <span>{(status.cronJobs ?? []).length} jobs</span>
      </KeyValue>
    </Section>
  );
}
