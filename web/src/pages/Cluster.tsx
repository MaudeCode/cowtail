import type { ItemStatsResponse } from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";

import ClusterHealth from "../components/dashboard/ClusterHealth";
import { Empty, KeyValue, QueryError, Section } from "../components/ui";
import { formatClock, formatDay, formatPercent, formatShortDate } from "../lib/format";
import { healthQuery, statsQuery } from "../lib/queries";

// One colour per source, in the order the legend lists them.
const SOURCE_COLORS = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-warn)",
  "var(--color-ok)",
  "var(--color-gray-400)",
];
const BAR_MAX_PX = 64;

function Volume({ stats }: { stats: ItemStatsResponse }) {
  const sources = [
    ...new Set(stats.dailyVolume.flatMap((day) => Object.keys(day.bySource))),
  ].sort();
  const color = (source: string) => SOURCE_COLORS[sources.indexOf(source) % SOURCE_COLORS.length];
  const peak = Math.max(1, ...stats.dailyVolume.map((day) => day.total));
  return (
    <Section label="Volume · 7 days" detail={stats.createdCount}>
      <div className="flex items-end gap-1.5 pt-2.5">
        {stats.dailyVolume.map((day) => (
          <div
            key={day.date}
            className="flex flex-1 flex-col items-stretch gap-px text-center font-mono text-[0.6rem] text-gray-600"
          >
            <span>{day.total}</span>
            {sources
              .filter((source) => day.bySource[source])
              .map((source) => (
                <i
                  key={source}
                  className="block"
                  style={{
                    height: `${(day.bySource[source] / peak) * BAR_MAX_PX}px`,
                    background: color(source),
                  }}
                />
              ))}
            <span>{formatDay(day.date).split(" ")[0]}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 py-1.5 font-mono text-[0.6rem] text-gray-600">
        {sources.map((source) => (
          <span key={source}>
            <i className="mr-1 inline-block size-[7px]" style={{ background: color(source) }} />
            {source}
          </span>
        ))}
      </div>
    </Section>
  );
}

function lastSeen(at: number) {
  return formatShortDate(at) === formatShortDate(Date.now())
    ? formatClock(at)
    : `${formatShortDate(at)} ${formatClock(at)}`;
}

export default function Cluster() {
  const health = useQuery(healthQuery);
  const stats = useQuery(statsQuery());
  const data = stats.data;

  return (
    <div className="grid gap-x-[30px] min-[960px]:grid-cols-[1fr_1fr_1.2fr]">
      <div>
        {health.data ? (
          <ClusterHealth health={health.data} layout="cluster" />
        ) : (
          <Section label="Alert pipeline">
            {health.error && <QueryError error={health.error} />}
          </Section>
        )}
      </div>
      <div>
        <Section label="Firing by namespace" detail={data?.firingCount}>
          {stats.error && <QueryError error={stats.error} />}
          {data?.firingByNamespace.map((row) => (
            <KeyValue
              key={row.namespace}
              label={
                <>
                  {row.namespace || "–"}
                  {row.titles && row.titles.length > 0 && (
                    <div className="text-[0.7rem] text-gray-600">
                      {row.titles.length > 2
                        ? `${row.titles.slice(0, 2).join(", ")}, +${row.titles.length - 2}`
                        : row.titles.join(", ")}
                    </div>
                  )}
                </>
              }
            >
              {row.count}
            </KeyValue>
          ))}
          {data?.firingByNamespace.length === 0 && <Empty>Nothing firing.</Empty>}
        </Section>
      </div>
      <div>
        {data ? <Volume stats={data} /> : <Section label="Volume · 7 days" />}
        <Section label="Noisiest">
          {data && data.repeatOffenders.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  {["Alert", "Count", "Noise", "Last seen"].map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.repeatOffenders.map((row) => (
                  <tr key={row.dedupeKey}>
                    <td>{row.title}</td>
                    <td className="font-mono">{row.occurrenceCount}</td>
                    <td className="font-mono">{formatPercent(row.noiseShare)}</td>
                    <td className="font-mono text-gray-600">{lastSeen(row.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data?.repeatOffenders.length === 0 && <Empty>No repeats this week.</Empty>}
        </Section>
      </div>
    </div>
  );
}
