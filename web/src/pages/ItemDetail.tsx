import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import ItemActions from "../components/items/ItemActions";
import SourceIcon from "../components/items/SourceIcon";
import type { ItemEventRecord, PriorOccurrence } from "@maudecode/cowtail-protocol";

import { Badge, DataTable, Icon, KeyValue, QueryError, Section } from "../components/ui";
import { formatClock, formatShortDate } from "../lib/format";
import {
  eventText,
  eventTone,
  outcomeTone,
  stateTone,
  toneFill,
  urgencyTone,
} from "../lib/itemPresentation";
import { itemQuery } from "../lib/queries";

// The steps behind a Hermes update, collapsed: each a numbered line, then its command and
// output in one monospace block.
function Evidence({ steps }: { steps: NonNullable<ItemEventRecord["evidence"]> }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[0.7rem] text-gray-600">
        {`Evidence · ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
      </summary>
      {steps.map((step, index) => {
        const block = [step.command && `$ ${step.command}`, step.output].filter(Boolean);
        return (
          <div key={index}>
            <div className="mt-1.5 text-[0.7rem] text-gray-600">{`${index + 1} · ${step.step}`}</div>
            {block.length > 0 && (
              <pre className="mt-1 border-l-2 border-gray-200 bg-surface px-2 py-1.5 font-mono text-[0.68rem] leading-[1.45] whitespace-pre-wrap text-[#c9c9cf] [overflow-wrap:anywhere]">
                {block.join("\n")}
              </pre>
            )}
          </div>
        );
      })}
    </details>
  );
}

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
        </div>
        <ItemActions item={item} />
      </header>

      <div className="grid gap-x-[30px] min-[960px]:grid-cols-2">
        <Section label="Timeline">
          <ol className="mt-2">
            {events.map((event, index) => (
              <li
                key={event.id}
                className={`relative ml-1 border-l pb-3 pl-4 ${index === events.length - 1 ? "border-transparent" : "border-gray-200"}`}
              >
                <i
                  className={`absolute top-1 -left-1 size-[7px] rounded-full ${toneFill[eventTone[event.type]]}`}
                />
                <time className="float-right font-mono text-[0.65rem] text-gray-600">
                  {formatClock(event.at)}
                </time>
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-gray-600">
                  {event.type}
                </div>
                <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {eventText(event)}
                </div>
                {event.evidence && event.evidence.length > 0 && <Evidence steps={event.evidence} />}
              </li>
            ))}
          </ol>
        </Section>
        <div>
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
