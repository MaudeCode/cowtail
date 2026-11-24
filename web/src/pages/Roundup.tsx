import { useSearchParams } from "react-router-dom";
import { alertListResponseSchema, fixListResponseSchema } from "@maudecode/cowtail-protocol";
import { useQuery } from "@tanstack/react-query";
import { resolveRoundupWindow } from "../../convex/roundup";
import { api } from "../lib/api";
import { formatTs } from "../lib/format";
import { parseLocalDate, formatDateLocal } from "../lib/dates";
import { BuildVersion, SeverityLabel } from "../components/ui";
import type { AlertOutcome as Outcome } from "@maudecode/cowtail-protocol";

const outcomeColors: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-gray-500", text: "text-gray-500", label: "Pending" },
  recorded: { bg: "bg-gray-400", text: "text-gray-500", label: "Recorded" },
  fixed: { bg: "bg-outcome-fixed", text: "text-outcome-fixed", label: "Fixed" },
  "self-resolved": { bg: "bg-self-resolved", text: "text-self-resolved", label: "Self Resolved" },
  noise: { bg: "bg-noise", text: "text-noise", label: "Noise" },
  escalated: { bg: "bg-escalated", text: "text-escalated", label: "Escalated" },
};

function formatDateRange(from: string, to: string) {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fromStr = f.toLocaleDateString("en-US", opts);
  const toStr = t.toLocaleDateString("en-US", opts);
  const year = t.toLocaleDateString("en-US", { year: "numeric" });
  if (fromStr === toStr) return `${fromStr}, ${year}`;
  return `${fromStr}–${toStr}, ${year}`;
}

function getDefaultRange() {
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  return {
    from: formatDateLocal(twoDaysAgo),
    to: formatDateLocal(now),
  };
}

export default function Roundup() {
  const [searchParams] = useSearchParams();
  const defaults = getDefaultRange();
  const fromParam = searchParams.get("from") ?? defaults.from;
  const toParam = searchParams.get("to") ?? defaults.to;
  const roundupTimeZone = import.meta.env.VITE_ROUNDUP_TIMEZONE || "America/New_York";
  const roundupWindow = resolveRoundupWindow(fromParam, toParam, roundupTimeZone);

  const range = `?from=${roundupWindow.fromTimestamp}&to=${roundupWindow.toTimestamp}`;
  const { data: alertList, isPending } = useQuery({
    queryKey: ["roundup", "alerts", range],
    queryFn: () => api(`/api/alerts${range}`, alertListResponseSchema),
  });
  const { data: fixList, isPending: fixesPending } = useQuery({
    queryKey: ["roundup", "fixes", range],
    queryFn: () => api(`/api/fixes${range}`, fixListResponseSchema),
  });

  const alerts = alertList?.alerts ?? [];
  const fixes = fixList?.fixes ?? [];

  const stats = {
    total: alerts.length,
    pending: alerts.filter((a) => a.outcome === "pending").length,
    recorded: alerts.filter((a) => a.outcome === "recorded").length,
    fixed: alerts.filter((a) => a.outcome === "fixed").length,
    selfResolved: alerts.filter((a) => a.outcome === "self-resolved").length,
    noise: alerts.filter((a) => a.outcome === "noise").length,
    escalated: alerts.filter((a) => a.outcome === "escalated").length,
    fixes: fixes.length,
  };

  // Group by outcome
  const grouped = alerts.reduce<Record<string, typeof alerts>>((acc, a) => {
    (acc[a.outcome] ??= []).push(a);
    return acc;
  }, {});

  const outcomeOrder: Outcome[] = [
    "pending",
    "escalated",
    "fixed",
    "self-resolved",
    "recorded",
    "noise",
  ];

  return (
    <div className="font-sans bg-bg text-txt min-h-screen grid-bg">
      <div className="max-w-[700px] mx-auto px-6 py-10 max-lg:px-4 max-lg:py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-end justify-between">
            <h1 className="text-4xl font-bold tracking-[-0.03em] uppercase max-lg:text-2xl">
              Cow<span className="text-accent title-glow">tail</span>
              <span className="text-gray-400 font-normal text-lg ml-3 max-lg:text-sm max-lg:ml-2">
                Roundup
              </span>
            </h1>
            <a
              href="/"
              className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-gray-400 hover:text-accent transition-colors pb-1"
            >
              ← Home
            </a>
          </div>
          <div className="font-mono text-[0.75rem] text-gray-400 uppercase tracking-[0.12em] mt-2">
            {formatDateRange(fromParam, toParam)}
            <BuildVersion />
          </div>
        </div>

        {isPending || fixesPending ? (
          <div className="text-gray-400 font-mono text-sm py-20 text-center">Loading...</div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-8 gap-px bg-gray-200 mb-8 max-lg:grid-cols-3">
              {[
                { label: "Total", value: stats.total, color: "" },
                { label: "Pending", value: stats.pending, color: "text-gray-500" },
                { label: "Recorded", value: stats.recorded, color: "text-gray-500" },
                { label: "Fixed", value: stats.fixed, color: "text-outcome-fixed" },
                { label: "S-Resolved", value: stats.selfResolved, color: "text-self-resolved" },
                { label: "Noise", value: stats.noise, color: "text-noise" },
                { label: "Escalated", value: stats.escalated, color: "text-escalated" },
                { label: "Fixes", value: stats.fixes, color: "text-[#3b82f6]" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="bg-surface px-4 py-4 text-center max-lg:px-2 max-lg:py-3"
                >
                  <div className={`text-2xl font-bold leading-none max-lg:text-lg ${s.color}`}>
                    {s.value}
                  </div>
                  <div className="font-mono text-[0.5rem] uppercase tracking-[0.12em] text-gray-400 mt-1">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Alert sections grouped by outcome */}
            {outcomeOrder.map((outcome) => {
              const items = grouped[outcome];
              if (!items?.length) return null;
              const oc = outcomeColors[outcome];

              return (
                <div key={outcome} className="mb-8">
                  <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-gray-400 border-b-2 border-gray-200 pb-2 mb-4">
                    {oc.label} <span className={oc.text}>({items.length})</span>
                  </h2>

                  {items
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .map((a) => (
                      <div
                        key={a.id}
                        className="mb-4 border-l-[3px] border-l-gray-200 pl-4 pb-4 last:pb-0 hover:border-l-accent transition-colors duration-150"
                      >
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span
                            className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[2px] font-medium text-white ${oc.bg}`}
                          >
                            {oc.label}
                          </span>
                          <SeverityLabel severity={a.severity} className="text-[0.65rem]" />
                          <span className="font-mono text-[0.65rem] text-gray-400">
                            {formatTs(new Date(a.timestamp).toISOString())}
                          </span>
                        </div>

                        <div className="font-semibold text-[0.9rem] tracking-[-0.01em] mb-1">
                          {a.alertname}
                          {a.node && (
                            <span className="font-normal text-gray-400 ml-2 text-[0.8rem]">
                              {a.node}
                            </span>
                          )}
                        </div>

                        <div className="text-[0.8rem] text-gray-600 leading-relaxed mb-1">
                          {a.summary}
                        </div>

                        {a.rootCause && (
                          <div className="mt-2">
                            <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">
                              Root cause:{" "}
                            </span>
                            <span className="text-[0.8rem] text-gray-600">{a.rootCause}</span>
                          </div>
                        )}

                        <div className="mt-1">
                          <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">
                            Action:{" "}
                          </span>
                          <span className="text-[0.8rem] text-gray-600">{a.action}</span>
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}

            {fixes.length > 0 && (
              <div className="mb-8">
                <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-gray-400 border-b-2 border-gray-200 pb-2 mb-4">
                  Fixes Applied <span className="text-[#3b82f6]">({fixes.length})</span>
                </h2>

                {fixes
                  .sort((a, b) => a.timestamp - b.timestamp)
                  .map((fix) => (
                    <div
                      key={fix.id}
                      className="mb-4 border-l-[3px] border-l-gray-200 pl-4 pb-4 last:pb-0 hover:border-l-accent transition-colors duration-150"
                    >
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[2px] font-medium text-white bg-[#3b82f6]">
                          {fix.scope}
                        </span>
                        <span className="font-mono text-[0.65rem] text-gray-400">
                          {formatTs(new Date(fix.timestamp).toISOString())}
                        </span>
                        {fix.commit && (
                          <span className="font-mono text-[0.65rem] text-gray-400">
                            {fix.commit.slice(0, 7)}
                          </span>
                        )}
                      </div>

                      <div className="font-semibold text-[0.9rem] tracking-[-0.01em] mb-1">
                        {fix.description}
                      </div>

                      {fix.rootCause && (
                        <div className="mt-1">
                          <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">
                            Root cause:{" "}
                          </span>
                          <span className="text-[0.8rem] text-gray-600">{fix.rootCause}</span>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {alerts.length === 0 && fixes.length === 0 && (
              <div className="text-center py-20 text-gray-400 font-mono text-sm uppercase tracking-wider">
                No alerts or fixes in this period
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 mt-8 text-center">
              <a
                href={`/history?from=${fromParam}&to=${toParam}`}
                className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-accent hover:text-txt transition-colors"
              >
                ← View in History
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
