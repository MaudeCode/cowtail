import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import { formatTs } from '../lib/format';
import type { Outcome } from '../types';

interface ConvexAlert {
  _id: string;
  _creationTime: number;
  timestamp: number;
  alertname: string;
  severity: string;
  namespace: string;
  node?: string;
  status: string;
  outcome: string;
  summary: string;
  action: string;
  rootCause?: string;
  messaged: boolean;
  resolvedAt?: number;
}

const outcomeColors: Record<string, { bg: string; text: string; label: string }> = {
  fixed: { bg: 'bg-outcome-fixed', text: 'text-outcome-fixed', label: 'Fixed' },
  'self-resolved': { bg: 'bg-self-resolved', text: 'text-self-resolved', label: 'Self Resolved' },
  noise: { bg: 'bg-noise', text: 'text-noise', label: 'Noise' },
  escalated: { bg: 'bg-escalated', text: 'text-escalated', label: 'Escalated' },
};

const severityStyle: Record<string, string> = {
  critical: 'text-accent font-bold',
  warning: 'text-escalated',
  info: 'text-gray-400',
};

function formatDateRange(from: string, to: string) {
  const f = new Date(from);
  const t = new Date(to);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'America/New_York' };
  const fromStr = f.toLocaleDateString('en-US', opts);
  const toStr = t.toLocaleDateString('en-US', opts);
  const year = t.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'America/New_York' });
  if (fromStr === toStr) return `${fromStr}, ${year}`;
  return `${fromStr}–${toStr}, ${year}`;
}

function getDefaultRange() {
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  return {
    from: twoDaysAgo.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default function Digest() {
  const [searchParams] = useSearchParams();
  const defaults = getDefaultRange();
  const fromParam = searchParams.get('from') ?? defaults.from;
  const toParam = searchParams.get('to') ?? defaults.to;

  const from = new Date(fromParam).getTime();
  const to = new Date(toParam + 'T23:59:59Z').getTime();

  const { data: convexAlerts, isPending } = useQuery(
    convexQuery(api.alerts.getByTimeRange, { from, to })
  );

  const alerts = (convexAlerts as ConvexAlert[] | undefined) ?? [];

  const stats = {
    total: alerts.length,
    fixed: alerts.filter(a => a.outcome === 'fixed').length,
    selfResolved: alerts.filter(a => a.outcome === 'self-resolved').length,
    noise: alerts.filter(a => a.outcome === 'noise').length,
    escalated: alerts.filter(a => a.outcome === 'escalated').length,
  };

  // Group by outcome
  const grouped = alerts.reduce<Record<string, ConvexAlert[]>>((acc, a) => {
    (acc[a.outcome] ??= []).push(a);
    return acc;
  }, {});

  const outcomeOrder: Outcome[] = ['escalated', 'fixed', 'self-resolved', 'noise'];

  return (
    <div className="font-sans bg-bg text-txt min-h-screen grid-bg">
      <div className="max-w-[700px] mx-auto px-6 py-10 max-lg:px-4 max-lg:py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-end justify-between">
            <h1 className="text-4xl font-bold tracking-[-0.03em] uppercase max-lg:text-2xl">
              Cow<span className="text-accent title-glow">tail</span>
              <span className="text-gray-400 font-normal text-lg ml-3 max-lg:text-sm max-lg:ml-2">Digest</span>
            </h1>
            <a href="/" className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-gray-400 hover:text-accent transition-colors pb-1">
              ← Dashboard
            </a>
          </div>
          <div className="font-mono text-[0.75rem] text-gray-400 uppercase tracking-[0.12em] mt-2">
            {formatDateRange(fromParam, toParam)}
          </div>
        </div>

        {isPending ? (
          <div className="text-gray-400 font-mono text-sm py-20 text-center">Loading...</div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-5 gap-px bg-gray-200 mb-8 max-lg:grid-cols-5">
              {[
                { label: 'Total', value: stats.total, color: '' },
                { label: 'Fixed', value: stats.fixed, color: 'text-outcome-fixed' },
                { label: 'S-Resolved', value: stats.selfResolved, color: 'text-self-resolved' },
                { label: 'Noise', value: stats.noise, color: 'text-noise' },
                { label: 'Escalated', value: stats.escalated, color: 'text-escalated' },
              ].map(s => (
                <div key={s.label} className="bg-surface px-4 py-4 text-center max-lg:px-2 max-lg:py-3">
                  <div className={`text-2xl font-bold leading-none max-lg:text-lg ${s.color}`}>{s.value}</div>
                  <div className="font-mono text-[0.5rem] uppercase tracking-[0.12em] text-gray-400 mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Alert sections grouped by outcome */}
            {outcomeOrder.map(outcome => {
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
                    .map(a => (
                    <div key={a._id} className="mb-4 border-l-[3px] border-l-gray-200 pl-4 pb-4 last:pb-0 hover:border-l-accent transition-colors duration-150">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[2px] font-medium text-white ${oc.bg}`}>
                          {oc.label}
                        </span>
                        <span className={`font-mono text-[0.65rem] uppercase ${severityStyle[a.severity] ?? ''}`}>
                          {a.severity}
                        </span>
                        <span className="font-mono text-[0.65rem] text-gray-400">
                          {formatTs(new Date(a.timestamp).toISOString())}
                        </span>
                      </div>

                      <div className="font-semibold text-[0.9rem] tracking-[-0.01em] mb-1">
                        {a.alertname}
                        {a.node && <span className="font-normal text-gray-400 ml-2 text-[0.8rem]">{a.node}</span>}
                      </div>

                      <div className="text-[0.8rem] text-gray-600 leading-relaxed mb-1">{a.summary}</div>

                      {a.rootCause && (
                        <div className="mt-2">
                          <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">Root cause: </span>
                          <span className="text-[0.8rem] text-gray-600">{a.rootCause}</span>
                        </div>
                      )}

                      <div className="mt-1">
                        <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">Action: </span>
                        <span className="text-[0.8rem] text-gray-600">{a.action}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {alerts.length === 0 && (
              <div className="text-center py-20 text-gray-400 font-mono text-sm uppercase tracking-wider">
                No alerts in this period
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 mt-8 text-center">
              <a href={`/?from=${fromParam}&to=${toParam}`} className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-accent hover:text-txt transition-colors">
                ← View in Dashboard
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
