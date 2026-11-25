import type { IncidentSummary, ItemRecord } from "@maudecode/cowtail-protocol";
import { Link } from "react-router-dom";

import { formatAge, formatDuration, formatReturnTime } from "../../lib/format";
import {
  investigationLabel,
  memberCountText,
  toneText,
  urgencyTone,
} from "../../lib/itemPresentation";
import { useNow } from "../../lib/useNow";
import { Badge, Icon } from "../ui";
import ItemActions from "./ItemActions";
import SourceIcon from "./SourceIcon";

export function itemPath(id: string) {
  return `/items/${encodeURIComponent(id)}`;
}

export function incidentPath(id: string) {
  return `/incidents/${encodeURIComponent(id)}`;
}

// "Incident · 11 items · now · 47m", the worst urgency in its tone.
export function IncidentLine({ incident }: { incident: IncidentSummary }) {
  return (
    <>
      Incident · {memberCountText(incident.memberCount)}
      {incident.worstUrgency && (
        <>
          {" · "}
          <span className={toneText[urgencyTone[incident.worstUrgency]]}>
            {incident.worstUrgency}
          </span>
        </>
      )}
      {` · ${formatDuration(incident.durationMs)}`}
    </>
  );
}

// The row that stands for a whole incident in any inbox section; it opens the incident.
function IncidentRow({ incident }: { incident: IncidentSummary }) {
  return (
    <Link
      to={incidentPath(incident.id)}
      className="flex items-start gap-2.5 border-b border-line py-2 hover:[&_.title]:underline"
    >
      <SourceIcon glyph="layers" />
      <div className="min-w-0 flex-1">
        <div className="title font-medium [overflow-wrap:anywhere]">{incident.title}</div>
        <div className="text-[0.7rem] text-gray-600">
          <IncidentLine incident={incident} />
        </div>
      </div>
      <Icon name="chev" className="mt-1 size-3.5 text-gray-600" />
    </Link>
  );
}

// What needs the owner says why it is urgent: its investigation, its deadline or its urgency.
function NeedsYouStatus({ item, now }: { item: ItemRecord; now: number }) {
  const status = item.investigationStep
    ? investigationLabel[item.investigationStep]
    : item.expiresAt !== undefined
      ? `expires in ${formatDuration(item.expiresAt - now)}`
      : item.urgency;
  return <span className={toneText[urgencyTone[item.urgency]]}>{status}</span>;
}

// One item in Needs you, Hermes is on it or Upcoming.
export default function ItemRow({
  item,
  variant,
}: {
  item: ItemRecord;
  variant: "needsYou" | "withHermes" | "upcoming";
}) {
  const source = item.sourceInfo.displayName;
  const now = useNow();
  if (item.incident) return <IncidentRow incident={item.incident} />;
  return (
    <div className="flex flex-wrap items-start gap-2.5 border-b border-line py-2">
      <SourceIcon source={item.sourceInfo} />
      <div className="min-w-0 flex-1 basis-[180px]">
        <Link
          to={itemPath(item.id)}
          className="flex items-center gap-1.5 font-medium hover:underline"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
          {item.occurrenceCount > 1 && <Badge>×{item.occurrenceCount}</Badge>}
        </Link>
        {variant === "needsYou" && item.kind === "approval" && item.body && (
          <div className="font-mono text-[0.7rem] text-gray-600 [overflow-wrap:anywhere]">
            {item.body}
          </div>
        )}
        <div className="text-[0.7rem] text-gray-600 [overflow-wrap:anywhere]">
          {variant === "upcoming" ? (
            item.snoozedUntil !== undefined && formatReturnTime(item.snoozedUntil, now)
          ) : variant === "needsYou" ? (
            <>
              {item.subtitle && `${item.subtitle} · `}
              {source} · {item.kind} · <NeedsYouStatus item={item} now={now} />
            </>
          ) : item.latestUpdate ? (
            <>
              <span className="text-info">Hermes</span> {item.latestUpdate.text}
            </>
          ) : (
            `${item.subtitle ? `${item.subtitle} · ` : ""}${source} · ${item.kind} · ${
              item.investigationStep ? investigationLabel[item.investigationStep] : item.state
            }`
          )}
        </div>
      </div>
      {variant === "upcoming" ? (
        <ItemActions item={item} types={["unsnooze"]} />
      ) : variant === "needsYou" ? (
        <ItemActions item={item} />
      ) : (
        <span className="shrink-0 font-mono text-[0.7rem] text-gray-600">
          {formatAge(item.latestUpdate?.at ?? item.updatedAt, now)}
        </span>
      )}
    </div>
  );
}
