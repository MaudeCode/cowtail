import type { ItemGraphResponse } from "@maudecode/cowtail-protocol";

import { formatClock, formatWhen } from "../../lib/format";

const WIDTH = 420;
const TOP = 6;
const BOTTOM = 102;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 3 });

// A line per series over the range, with the alert's threshold as a dashed rule and its firing
// interval as a shaded band. The server sends only graphs it could fill.
export default function MetricGraph({ graph }: { graph: ItemGraphResponse }) {
  const { from = 0, to = 0, threshold, firing, series = [] } = graph;
  const values = series.flatMap((line) => line.points.map((point) => point.value));
  if (threshold) values.push(threshold.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.1 || Math.abs(high) * 0.1 || 1;
  const min = low - pad;
  const max = high + pad;

  const x = (at: number) => ((at - from) / (to - from || 1)) * WIDTH;
  const y = (value: number) => BOTTOM - ((value - min) / (max - min)) * (BOTTOM - TOP);

  const band = firing && {
    start: x(Math.max(firing.startsAt, from)),
    end: x(Math.min(firing.endsAt ?? to, to)),
  };
  const firingText = firing
    ? firing.endsAt === undefined
      ? `firing since ${formatClock(firing.startsAt)}`
      : `firing ${formatClock(firing.startsAt)}–${formatClock(firing.endsAt)}`
    : undefined;
  const thresholdText = threshold && `${threshold.op} ${compact.format(threshold.value)}`;
  const label = [`${graph.query} over ${graph.range}`, thresholdText, firingText]
    .filter(Boolean)
    .join(", ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} 120`}
      width="100%"
      role="img"
      aria-label={label}
      className="my-2 block font-mono text-[9px]"
    >
      {band && band.end > band.start && (
        <rect
          x={band.start}
          y={TOP}
          width={band.end - band.start}
          height={BOTTOM - TOP}
          className="fill-accent opacity-[0.16]"
        />
      )}
      {threshold && (
        <>
          <line
            x1={0}
            x2={WIDTH}
            y1={y(threshold.value)}
            y2={y(threshold.value)}
            strokeDasharray="4 4"
            className="stroke-accent-text"
          />
          <text x={4} y={y(threshold.value) - 5} className="fill-accent-text">
            {thresholdText}
          </text>
        </>
      )}
      {series.map((line, index) => (
        <polyline
          key={index}
          fill="none"
          strokeWidth={1.6}
          strokeLinejoin="round"
          className="stroke-txt"
          points={line.points.map((point) => `${x(point.at)},${y(point.value)}`).join(" ")}
        />
      ))}
      <text x={0} y={114} className="fill-gray-600">
        {formatWhen(from, to)}
      </text>
      {band && band.end > band.start && (
        <text
          x={Math.min(Math.max(band.start + 2, 36), WIDTH - 136)}
          y={114}
          className="fill-gray-600"
        >
          {firingText}
        </text>
      )}
      <text x={WIDTH} y={114} textAnchor="end" className="fill-gray-600">
        {formatWhen(to, to)}
      </text>
    </svg>
  );
}
