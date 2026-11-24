import type { IncidentGetResponse, IncidentPostmortemState } from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { itemPath } from "../components/items/ItemRow";
import SourceIcon from "../components/items/SourceIcon";
import Timeline from "../components/items/Timeline";
import {
  ActionError,
  Badge,
  DataTable,
  Empty,
  IconButton,
  Markdown,
  QueryError,
  Section,
} from "../components/ui";
import { formatClock, formatDuration, formatSpan } from "../lib/format";
import {
  incidentStateTone,
  itemResult,
  memberCountText,
  urgencyTone,
} from "../lib/itemPresentation";
import {
  incidentCandidatesQuery,
  incidentQuery,
  useIncidentChange,
  type IncidentChange,
} from "../lib/queries";

const postmortemWaiting: Record<IncidentPostmortemState, string> = {
  none: "Hermes writes the postmortem once the incident resolves.",
  requested: "Hermes is writing the postmortem.",
  written: "",
  failed: "No postmortem arrived in time. Request it again.",
};

// The items the server says can join, each a choice that adds it.
function AddItemDialog({
  id,
  onAdd,
  onClose,
}: {
  id: string;
  onAdd: (itemId: string) => void;
  onClose: () => void;
}) {
  const candidates = useQuery(incidentCandidatesQuery(id));
  return (
    <dialog
      open
      aria-label="Add an item"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
      className="absolute top-full right-0 left-auto z-10 m-0 mt-1.5 grid max-h-[calc(100dvh-64px)] w-[320px] max-w-[calc(100vw-32px)] grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-[10px] border border-gray-200 bg-surface-2 px-3 pt-1 pb-2 text-left text-txt shadow-[0_14px_34px_#000c]"
    >
      <h3 className="py-1.5 font-mono text-[0.6rem] font-normal uppercase tracking-[0.13em] text-gray-600">
        Add an item
      </h3>
      {candidates.error && <ActionError error={candidates.error} />}
      {candidates.data?.length === 0 && <Empty>No item to add.</Empty>}
      {candidates.data?.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onAdd(item.id)}
          className="flex cursor-pointer items-center justify-between gap-3 border-b border-line py-1.5 text-left text-[0.8rem]"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
          <span className="shrink-0 font-mono text-[0.7rem] text-gray-600">
            {formatClock(item.createdAt)}
          </span>
        </button>
      ))}
    </dialog>
  );
}

type Change = ReturnType<typeof useIncidentChange>;

function Header({
  detail,
  id,
  change,
}: {
  detail: IncidentGetResponse;
  id: string;
  change: Change;
}) {
  const { incident } = detail;
  const [adding, setAdding] = useState(false);
  const send = (next: IncidentChange) => change.mutate(next);
  const offers = new Set(incident.availableActions);
  // Only an add waits on the server for its result; the other changes show theirs at once.
  const addPending = change.isPending && change.variables?.type === "add";
  return (
    <header className="flex flex-wrap items-center gap-2.5 border-b border-gray-200 pt-3.5 pb-3">
      <SourceIcon glyph="layers" large />
      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="text-[0.7rem] text-gray-600">
          Incident · {formatSpan(incident.startedAt, incident.resolvedAt)}
        </div>
        <h1 className="text-[1.05rem] font-medium break-words">{incident.title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={incidentStateTone[incident.state]}>{incident.state}</Badge>
        <Badge>{memberCountText(incident.memberCount)}</Badge>
        {incident.worstUrgency && (
          <Badge tone={urgencyTone[incident.worstUrgency]}>{incident.worstUrgency}</Badge>
        )}
        <Badge>{formatDuration(incident.durationMs)}</Badge>
      </div>
      <div className="relative flex items-center gap-1.5">
        <IconButton
          icon="plus"
          label="Add an item"
          aria-expanded={adding}
          disabled={addPending}
          aria-busy={addPending}
          onClick={() => setAdding(!adding)}
        />
        <IconButton
          icon="refresh"
          label="Request postmortem again"
          disabled={!offers.has("request_postmortem")}
          onClick={() => send({ type: "request_postmortem" })}
        />
        {offers.has("resolve") && (
          <IconButton icon="check" label="Resolve" onClick={() => send({ type: "resolve" })} />
        )}
        {adding && (
          <AddItemDialog
            id={id}
            onClose={() => setAdding(false)}
            onAdd={(itemId) => {
              setAdding(false);
              send({ type: "add", itemId });
            }}
          />
        )}
      </div>
      <div className="basis-full empty:hidden">
        <ActionError error={change.error} />
      </div>
    </header>
  );
}

function Members({ detail, change }: { detail: IncidentGetResponse; change: Change }) {
  return (
    <Section label="Members" detail={detail.incident.memberCount}>
      {detail.members.length === 0 && <Empty>No items.</Empty>}
      <DataTable>
        {detail.members.map((member) => {
          const result = itemResult(member);
          return (
            <tr key={member.id}>
              <td>
                <Link to={itemPath(member.id)} className="hover:underline">
                  {member.subtitle ? `${member.title} · ${member.subtitle}` : member.title}
                  {member.occurrenceCount > 1 && ` ×${member.occurrenceCount}`}
                </Link>
              </td>
              <td className="text-right">
                <Badge tone={result.tone}>{result.label}</Badge>
              </td>
              <td className="w-[26px]">
                <IconButton
                  icon="x"
                  small
                  label="Remove from incident"
                  onClick={() => change.mutate({ type: "remove", itemId: member.id })}
                />
              </td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

export default function IncidentDetail() {
  const { id = "" } = useParams();
  const { data, error } = useQuery(incidentQuery(id));
  const change = useIncidentChange(id);
  if (error) return <QueryError error={error} />;
  if (!data) return null;
  const { incident } = data;

  return (
    <>
      <Header detail={data} id={id} change={change} />
      <div className="grid gap-x-[30px] min-[960px]:grid-cols-[1fr_1.15fr]">
        <Section label="Timeline" detail="all members">
          <Timeline events={data.events} />
        </Section>
        <div>
          <Section
            label="Postmortem"
            detail={
              incident.postmortemAt !== undefined
                ? `Hermes · ${formatClock(incident.postmortemAt)}`
                : undefined
            }
          >
            {incident.postmortem ? (
              <div className="border-b border-line py-2">
                <Markdown text={incident.postmortem} />
              </div>
            ) : (
              <Empty>{postmortemWaiting[incident.postmortemState]}</Empty>
            )}
          </Section>
          <Members detail={data} change={change} />
        </div>
      </div>
    </>
  );
}
