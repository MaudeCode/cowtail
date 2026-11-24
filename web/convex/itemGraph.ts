import {
  itemGraphMaxPoints,
  itemGraphMaxSeries,
  itemGraphRangeMs,
  itemGraphThresholdOps,
  type ItemGraphRange,
  type ItemGraphResponse,
} from "@maudecode/cowtail-protocol";

type ThresholdOp = (typeof itemGraphThresholdOps)[number];
export type Threshold = { op: ThresholdOp; value: number };

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

const IDENTIFIER = /[A-Za-z0-9_:]/;
const SET_OPERATORS = ["and", "or", "unless"];

// A set operator (`and`, `or`, `unless`) at `i`, as a whole word.
function setOperatorAt(expr: string, i: number): boolean {
  if (i > 0 && IDENTIFIER.test(expr[i - 1])) return false;
  return SET_OPERATORS.some(
    (word) => expr.startsWith(word, i) && !IDENTIFIER.test(expr[i + word.length] ?? ""),
  );
}

// The last comparison outside any brackets, braces or quotes: in `a + b > 1` it splits off
// `1`, and `{x!="y"}` and `(a > 1)` hide theirs. A top-level set operator binds looser than any
// comparison, so the expression's root is no comparison and there is none to split.
function lastTopLevelComparison(expr: string): { at: number; op: ThresholdOp } | undefined {
  let depth = 0;
  let quote: string | undefined;
  let found: { at: number; op: ThresholdOp } | undefined;
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (OPENERS.has(char)) depth += 1;
    else if (CLOSERS.has(char)) depth -= 1;
    else if (depth === 0) {
      if (setOperatorAt(expr, i)) return undefined;
      const two = expr.slice(i, i + 2);
      if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
        found = { at: i, op: two };
        i += 1;
      } else if (char === ">" || char === "<") {
        found = { at: i, op: char };
      }
    }
  }
  return found;
}

// `<lhs> <op> <number>` queries `lhs` against the threshold; anything else queries itself.
export function splitThreshold(expr: string): { query: string; threshold?: Threshold } {
  const query = expr.trim();
  const comparison = lastTopLevelComparison(query);
  if (!comparison) return { query };
  const lhs = query.slice(0, comparison.at).trim();
  const rhs = query.slice(comparison.at + comparison.op.length).trim();
  const value = Number(rhs);
  if (!lhs || !NUMBER.test(rhs) || !Number.isFinite(value)) return { query };
  return { query: lhs, threshold: { op: comparison.op, value } };
}

// Prometheus links an alert to `/graph?g0.expr=<PromQL>`.
export function generatorExpression(generatorURL: string): string | undefined {
  try {
    return (
      new URL(generatorURL, "http://generator.invalid").searchParams.get("g0.expr")?.trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

export type GraphAlert = {
  generatorURL?: string;
  // The alert's labels; the series they name are the alert's own.
  labels?: Record<string, unknown>;
  firedAt: number;
  resolvedAt?: number;
};

export type RangeSeries = { metric: Record<string, string>; values: [number, string][] };
export type RangeQuery = (
  query: string,
  window: { start: number; end: number; step: number },
) => Promise<RangeSeries[]>;

function unavailable(range: ItemGraphRange, reason: string): ItemGraphResponse {
  return { ok: true, available: false, range, reason };
}

// The window ends now, or a sixth of the range after a resolved alert stopped firing, so the
// firing interval stays in view. The step gives at most 120 points over it.
export async function itemGraph(
  alert: GraphAlert | null,
  range: ItemGraphRange,
  now: number,
  queryRange: RangeQuery,
): Promise<ItemGraphResponse> {
  if (!alert) return unavailable(range, "The item has no alert");
  if (!alert.generatorURL) return unavailable(range, "The alert has no generator URL");
  const expr = generatorExpression(alert.generatorURL);
  if (!expr) return unavailable(range, "The alert's generator URL has no expression");

  const rangeMs = itemGraphRangeMs[range];
  const to = Math.min(now, alert.resolvedAt === undefined ? now : alert.resolvedAt + rangeMs / 6);
  const from = to - rangeMs;
  const { query, threshold } = splitThreshold(expr);

  let results: RangeSeries[];
  try {
    results = await queryRange(query, {
      start: from / 1000,
      end: to / 1000,
      step: rangeMs / itemGraphMaxPoints / 1000,
    });
  } catch (error) {
    return unavailable(range, error instanceof Error ? error.message : "Prometheus query failed");
  }

  // A series is the alert's when no label it shares with the alert differs; comparisons and
  // the rule's own labels add the rest. NaN and ±Inf samples have no place on a line and no
  // JSON form.
  const labels = alert.labels ?? {};
  const own = results.filter((result) =>
    Object.entries(result.metric).every(
      ([key, value]) => key === "__name__" || !(key in labels) || String(labels[key]) === value,
    ),
  );
  const series = own.slice(0, itemGraphMaxSeries).map((result) => ({
    labels: result.metric,
    points: result.values
      .map(([at, value]) => ({ at: Math.round(at * 1000), value: Number(value) }))
      .filter((point) => Number.isFinite(point.value))
      .slice(-itemGraphMaxPoints),
  }));
  if (!series.some((line) => line.points.length > 0)) {
    return unavailable(range, "Prometheus has no samples for the expression in this range");
  }

  return {
    ok: true,
    available: true,
    range,
    query,
    from,
    to,
    threshold,
    firing: { startsAt: alert.firedAt, endsAt: alert.resolvedAt },
    series,
  };
}
