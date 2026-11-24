import type { IncidentEventRecord, ItemEventRecord } from "@maudecode/cowtail-protocol";

import { outputBlock } from "../ui";
import { formatClock } from "../../lib/format";
import { eventText, eventTone, toneFill } from "../../lib/itemPresentation";

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
            {block.length > 0 && <pre className={`mt-1 ${outputBlock}`}>{block.join("\n")}</pre>}
          </div>
        );
      })}
    </details>
  );
}

// An item's timeline, or an incident's merged one, whose events name the member they concern.
export default function Timeline({
  events,
}: {
  events: (ItemEventRecord | IncidentEventRecord)[];
}) {
  return (
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
            {"itemTitle" in event && event.itemTitle
              ? `${event.type} · ${event.itemTitle}`
              : event.type}
          </div>
          <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{eventText(event)}</div>
          {event.evidence && event.evidence.length > 0 && <Evidence steps={event.evidence} />}
        </li>
      ))}
    </ol>
  );
}
