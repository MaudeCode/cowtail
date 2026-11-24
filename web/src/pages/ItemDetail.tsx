import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import ItemActions from "../components/items/ItemActions";
import SourceIcon from "../components/items/SourceIcon";
import { Badge, Icon, KeyValue, QueryError, Section } from "../components/ui";
import { formatClock } from "../lib/format";
import { eventText, eventTone, stateTone, toneFill, urgencyTone } from "../lib/itemPresentation";
import { itemQuery } from "../lib/queries";

export default function ItemDetail() {
  const { id = "" } = useParams();
  const { data, error } = useQuery(itemQuery(id));
  if (error) return <QueryError error={error} />;
  if (!data) return null;
  const { item, events } = data;
  const context = Object.entries(item.context);

  return (
    <>
      <header className="flex flex-wrap items-center gap-2.5 border-b border-gray-200 pt-3.5 pb-3">
        <SourceIcon source={item.sourceInfo} large />
        <div className="min-w-0 flex-1">
          <div className="text-[0.7rem] text-gray-600">
            {item.sourceInfo.displayName}
            {item.subtitle && ` · ${item.subtitle}`}
          </div>
          <h1 className="text-[1.05rem] font-medium [overflow-wrap:anywhere]">{item.title}</h1>
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
          {item.fix && (
            <Section label="Fix">
              <KeyValue label={item.fix.description}>
                <span className="font-mono">{item.fix.commit?.slice(0, 7) ?? item.fix.scope}</span>
              </KeyValue>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
