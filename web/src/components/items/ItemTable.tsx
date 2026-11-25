import type { ItemListResponse, ItemRecord } from "@maudecode/cowtail-protocol";
import { Fragment } from "react";
import { Link } from "react-router-dom";

import { formatClock, formatDay, formatDuration } from "../../lib/format";
import { incidentStateTone, itemResult } from "../../lib/itemPresentation";
import { Badge, Icon } from "../ui";
import { IncidentLine, incidentPath, itemPath } from "./ItemRow";

// A member that stands for its incident: the incident's title, line, state and duration.
function IncidentRow({ item }: { item: ItemRecord }) {
  const incident = item.incident!;
  return (
    <tr>
      <td className="font-mono text-[0.7rem] whitespace-nowrap text-gray-600">
        {formatClock(incident.startedAt)}
      </td>
      <td className="max-[599px]:hidden">Incident</td>
      <td className="font-medium">
        <Link to={incidentPath(incident.id)} className="hover:underline">
          {incident.title}
        </Link>
        <div className="text-[0.7rem] font-normal text-gray-600">
          <IncidentLine incident={incident} />
        </div>
      </td>
      <td>
        <Badge tone={incidentStateTone[incident.state]}>{incident.state}</Badge>
      </td>
      <td className="font-mono text-[0.7rem] whitespace-nowrap text-gray-600">
        {formatDuration(incident.durationMs)}
      </td>
      <td className="font-mono text-[0.7rem] text-gray-600">–</td>
    </tr>
  );
}

function Row({ item }: { item: ItemRecord }) {
  if (item.incident) return <IncidentRow item={item} />;
  const result = itemResult(item);
  return (
    <tr>
      <td className="font-mono text-[0.7rem] whitespace-nowrap text-gray-600">
        {formatClock(item.createdAt)}
      </td>
      <td className="max-[599px]:hidden">{item.sourceInfo.displayName}</td>
      <td className="font-medium">
        <Link to={itemPath(item.id)} className="hover:underline">
          {item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}
        </Link>
        {item.maintenanceWindowId && (
          <span title="Recorded during a maintenance window" className="ml-1.5 inline-block">
            <Icon name="wrench" className="inline size-3 align-[-1px] text-gray-600" />
            <span className="sr-only">Recorded during a maintenance window</span>
          </span>
        )}
        {/* Narrow screens fold the Source column into the item. */}
        <div className="text-[0.7rem] font-normal text-gray-600 min-[600px]:hidden">
          {item.sourceInfo.displayName}
        </div>
      </td>
      <td>
        <Badge tone={result.tone}>{result.label}</Badge>
      </td>
      <td className="font-mono text-[0.7rem] whitespace-nowrap text-gray-600">
        {item.resolvedAfterMs === undefined ? "–" : formatDuration(item.resolvedAfterMs)}
      </td>
      <td className="font-mono text-[0.7rem] text-gray-600" title={item.fix?.description}>
        {item.fix ? (item.fix.commit?.slice(0, 7) ?? item.fix.scope) : "–"}
      </td>
    </tr>
  );
}

const columns = ["Time", "Source", "Item", "Outcome", "Took", "Fix"];

// The History log, grouped by the server's day with each day's count.
export default function ItemTable({
  items,
  days,
}: {
  items: ItemRecord[];
  days: NonNullable<ItemListResponse["days"]>;
}) {
  const dayCount = new Map(days.map((day) => [day.date, day.count]));
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column}
              scope="col"
              className={column === "Source" ? "max-[599px]:hidden" : ""}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => {
          const day = item.createdDate;
          const startsDay = day !== undefined && day !== items[index - 1]?.createdDate;
          return (
            <Fragment key={item.id}>
              {startsDay && (
                <tr>
                  <th
                    colSpan={columns.length}
                    scope="colgroup"
                    className="!pt-3.5 !tracking-[0.13em]"
                  >
                    {formatDay(day)}
                    <span className="float-right">{dayCount.get(day)}</span>
                  </th>
                </tr>
              )}
              <Row item={item} />
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
