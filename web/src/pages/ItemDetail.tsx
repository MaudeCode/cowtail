import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import ItemActions from "../components/items/ItemActions";
import { incidentPath } from "../components/items/ItemRow";
import SourceIcon from "../components/items/SourceIcon";
import Timeline from "../components/items/Timeline";
import {
  itemGraphRanges,
  type ItemGraphRange,
  type PriorOccurrence,
} from "@maudecode/cowtail-protocol";
import { Link } from "react-router-dom";

import {
  Badge,
  DataTable,
  Icon,
  KeyValue,
  MetricGraph,
  QueryError,
  Section,
} from "../components/ui";
import { formatShortDate } from "../lib/format";
import { outcomeTone, stateTone, urgencyTone } from "../lib/itemPresentation";
import { itemGraphQuery, itemQuery } from "../lib/queries";

// One earlier firing, as the server chose to show it: when, how it ended, why, and the
// commit that fixed it.
function PriorOccurrenceRow({ prior }: { prior: PriorOccurrence }) {
  return (
    <tr>
      <td className="whitespace-nowrap font-mono text-gray-600">
        {formatShortDate(prior.firedAt)}
      </td>
      <td>
        <Badge tone={outcomeTone[prior.outcome]}>{prior.outcome}</Badge>
      </td>
      <td>{prior.cause}</td>
      <td className="whitespace-nowrap text-right font-mono text-gray-600">
        {prior.fixCommit?.slice(0, 7) ?? "–"}
      </td>
    </tr>
  );
}

// The alert's own metric, labelled with the expression drawn. Hidden when the server has no
// graph for the item, or cannot be reached for one.
function MetricGraphSection({ id }: { id: string }) {
  const [range, setRange] = useState<ItemGraphRange>("6h");
  const { data } = useQuery({ ...itemGraphQuery(id, range), placeholderData: (last) => last });
  if (!data?.available) return null;
  return (
    <Section
      label={<span className="break-all">{data.query}</span>}
      detail={
        <fieldset className="-my-1 flex overflow-hidden rounded-lg border border-gray-200 normal-case tracking-normal">
          <legend className="sr-only">Range</legend>
          {itemGraphRanges.map((option) => (
            <label
              key={option}
              className="w-10 cursor-pointer py-0.5 text-center text-[0.68rem] text-gray-600 has-checked:bg-surface-2 has-checked:font-semibold has-checked:text-txt has-focus-visible:outline"
            >
              <input
                type="radio"
                name="graph-range"
                value={option}
                checked={option === range}
                onChange={() => setRange(option)}
                className="sr-only"
              />
              {option}
            </label>
          ))}
        </fieldset>
      }
    >
      <MetricGraph graph={data} />
    </Section>
  );
}

export default function ItemDetail() {
  const { id = "" } = useParams();
  const { data, error } = useQuery(itemQuery(id));
  if (error) return <QueryError error={error} />;
  if (!data) return null;
  const { item, events, fixes = [], priorOccurrences = [] } = data;
  const context = (item.contextOrder ?? Object.keys(item.context)).flatMap((key) =>
    item.context[key] === undefined ? [] : [[key, item.context[key]] as const],
  );
  const result = item.investigationResult;

  return (
    <>
      <header className="flex flex-wrap items-center gap-2.5 border-b border-gray-200 pt-3.5 pb-3">
        <SourceIcon source={item.sourceInfo} large />
        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="text-[0.7rem] text-gray-600">
            {item.sourceInfo.displayName}
            {item.subtitle && ` · ${item.subtitle}`}
          </div>
          <h1 className="text-[1.05rem] font-medium break-words">{item.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{item.kind}</Badge>
          <Badge tone={urgencyTone[item.urgency]}>{item.urgency}</Badge>
          <Badge tone={stateTone[item.state]}>{item.state}</Badge>
          {item.occurrenceCount > 1 && <Badge>×{item.occurrenceCount}</Badge>}
          {item.incident && (
            <Link
              to={incidentPath(item.incident.id)}
              title={`Open incident ${item.incident.title}`}
              className="hover:underline"
            >
              <Badge>
                <Icon name="layers" className="size-3" />
                {item.incident.title}
              </Badge>
            </Link>
          )}
        </div>
        <ItemActions item={item} />
      </header>

      <div className="grid gap-x-[30px] min-[960px]:grid-cols-2">
        <Section label="Timeline">
          <Timeline events={events} />
        </Section>
        <div>
          <MetricGraphSection id={item.id} />
          <Section label="Details">
            {item.body && (
              <p className="my-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.body}</p>
            )}
            {context.length > 0 && (
              <div className="my-2 flex flex-wrap gap-1.5">
                {context.map(([key, value]) => (
                  <Badge key={key} className="whitespace-normal [overflow-wrap:anywhere]">
                    {key}={value}
                  </Badge>
                ))}
              </div>
            )}
            {result?.rootCause && <KeyValue label="Root cause">{result.rootCause}</KeyValue>}
            {result?.action && <KeyValue label="Action taken">{result.action}</KeyValue>}
            {result?.ownerNote && <KeyValue label="Your note">{result.ownerNote}</KeyValue>}
            {item.links.map((link) => (
              <KeyValue key={link.url} label={link.label}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${link.label}`}
                  aria-label={`Open ${link.label}`}
                >
                  <Icon name="link" />
                </a>
              </KeyValue>
            ))}
          </Section>
          {fixes.length > 0 && (
            <Section label="Fix">
              {fixes.map((fix) => (
                <KeyValue key={fix.id} label={fix.description}>
                  <span className="font-mono">{fix.commit?.slice(0, 7) ?? fix.scope}</span>
                </KeyValue>
              ))}
            </Section>
          )}
          {priorOccurrences.length > 0 && (
            <Section label="Past occurrences">
              <DataTable>
                {priorOccurrences.map((prior) => (
                  <PriorOccurrenceRow key={prior.alertId} prior={prior} />
                ))}
              </DataTable>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
