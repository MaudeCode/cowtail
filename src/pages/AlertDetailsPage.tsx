import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { Link, useParams } from 'react-router-dom';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import AlertDetail from '../components/dashboard/AlertDetail';
import FixesList from '../components/dashboard/FixesList';
import { toAlert } from '../lib/alerts';
import { formatTs } from '../lib/format';

const outcomeStyle = {
  fixed: 'bg-outcome-fixed text-white',
  'self-resolved': 'bg-self-resolved text-white',
  noise: 'bg-noise text-white',
  escalated: 'bg-escalated text-white',
} as const;

const severityStyle = {
  critical: 'text-accent severity-glow-critical',
  warning: 'text-escalated',
  info: 'text-gray-400',
} as const;

export default function AlertDetailsPage() {
  const { alertId = '' } = useParams();

  const { data, isPending } = useQuery({
    ...convexQuery(api.alerts.getById, {
      id: alertId as Id<'alerts'>,
    }),
    enabled: Boolean(alertId),
  });

  const { data: fixes = [], isPending: fixesPending } = useQuery({
    ...convexQuery(api.fixes.getByAlertIds, {
      alertIds: alertId ? [alertId as Id<'alerts'>] : [],
    }),
    enabled: Boolean(alertId),
  });

  const alert = data ? toAlert(data) : null;
  const outcomeClass = alert ? outcomeStyle[alert.outcome] : '';
  const severityClass = alert ? severityStyle[alert.severity] : '';

  return (
    <div className="min-h-screen bg-bg text-txt grid-bg">
      <header className="border-b-2 border-gray-200 header-glow">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between gap-4 max-lg:px-4">
          <div>
            <Link to="/" className="text-3xl font-bold tracking-[-0.03em] uppercase">
              Cow<span className="text-accent title-glow">tail</span>
            </Link>
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-gray-400 mt-1">
              Alert Detail
            </div>
          </div>

          <Link
            to="/"
            className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-gray-400 hover:text-accent transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 max-lg:px-4">
        {isPending && (
          <section className="border border-gray-200 bg-surface px-6 py-8">
            <div className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-gray-400">
              Loading alert…
            </div>
          </section>
        )}

        {!isPending && !alert && (
          <section className="border border-gray-200 bg-surface px-6 py-8">
            <div className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-gray-400 mb-2">
              Alert not found
            </div>
            <p className="text-[0.95rem] text-gray-600">
              Cowtail could not find an alert for <span className="font-mono">{alertId}</span>.
            </p>
          </section>
        )}

        {alert && (
          <div className="space-y-6">
            <section className="border-2 border-gray-200 bg-surface p-6 max-lg:p-4">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`inline-block font-mono text-[0.62rem] uppercase tracking-[0.08em] px-2 py-[3px] font-medium ${outcomeClass}`}>
                  {alert.outcome.replace('-', ' ')}
                </span>
                <span className={`font-mono text-[0.7rem] uppercase ${severityClass}`}>
                  {alert.severity}
                </span>
                <span className="font-mono text-[0.7rem] uppercase text-gray-400">
                  {alert.status}
                </span>
                <span className="font-mono text-[0.7rem] text-gray-400">
                  {formatTs(alert.timestamp)}
                </span>
              </div>

              <h1 className="text-3xl font-bold tracking-[-0.03em] text-txt max-lg:text-2xl">
                {alert.alertName}
              </h1>

              <p className="mt-3 text-[0.95rem] leading-relaxed text-gray-600">
                {alert.summary}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <MetadataCell label="Namespace" value={alert.namespace || 'Unknown'} />
                <MetadataCell label="Node" value={alert.node || 'Unknown'} />
                <MetadataCell label="Messaged" value={alert.messaged ? 'Yes' : 'No'} />
                <MetadataCell label="Resolved" value={alert.resolvedAt ? formatTs(alert.resolvedAt) : 'No'} />
                <MetadataCell label="Alert ID" value={alert.id} mono />
              </div>
            </section>

            <section className="border-2 border-gray-200 bg-surface overflow-hidden">
              <AlertDetail alert={alert} />
              {fixesPending ? (
                <div className="px-5 py-4 border-t border-gray-100 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-gray-400">
                  Loading fixes…
                </div>
              ) : (
                <FixesList fixes={fixes} />
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function MetadataCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-gray-200 bg-bg px-4 py-3">
      <div className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-gray-400 mb-1">
        {label}
      </div>
      <div className={mono ? 'font-mono text-[0.78rem] text-gray-600 break-all' : 'text-[0.9rem] text-gray-600'}>
        {value}
      </div>
    </div>
  );
}
