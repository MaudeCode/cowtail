import type { AlertGroup } from '../../hooks/useDashboard';
import AlertRow from './AlertRow';

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const outcomeBg: Record<string, string> = {
  'outcome-fixed': 'bg-outcome-fixed text-white',
  'outcome-self-resolved': 'bg-self-resolved text-white',
  'outcome-noise': 'bg-noise text-white',
  'outcome-escalated': 'bg-escalated text-white',
};

const severityStyle: Record<string, string> = {
  critical: 'text-accent font-bold severity-glow-critical',
  warning: 'text-escalated',
  info: 'text-gray-400',
};

interface AlertListProps {
  groups: AlertGroup[];
  expandedGroup: string | null;
  expandedAlert: string | null;
  onToggleGroup: (name: string) => void;
  onToggleAlert: (id: string) => void;
}

export default function AlertList({ groups, expandedGroup, expandedAlert, onToggleGroup, onToggleAlert }: AlertListProps) {
  return (
    <div className="px-10 max-md:px-5">
      <div className="grid grid-cols-[120px_1fr_80px_100px_120px_110px] gap-3 py-3.5 border-b-2 border-gray-200 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-gray-400 max-md:hidden">
        <span>Time</span>
        <span>Alert</span>
        <span>Severity</span>
        <span>Outcome</span>
      </div>

      {groups.length === 0 && (
        <div className="py-16 text-center text-gray-400 font-mono text-[0.85rem] uppercase tracking-[0.08em]">
          No alerts match the current filters
        </div>
      )}

      {groups.map(group => {
        const outcomeKey = `outcome-${group.alerts[0].outcome}` as keyof typeof outcomeBg;
        return (
          <div key={group.alertName}>
            <div
              className={`grid grid-cols-[120px_1fr_80px_110px] gap-3 py-3.5 border-b cursor-pointer transition-[background] duration-100 items-center text-[0.85rem] hover:bg-[rgba(184,36,44,0.04)] max-md:grid-cols-[1fr_1fr] max-md:gap-x-3 max-md:gap-y-1 max-md:py-3 ${
                expandedGroup === group.alertName ? 'border-b-accent bg-surface' : 'border-b-gray-100'
              }`}
              onClick={() => onToggleGroup(group.alertName)}
            >
              <span className="font-mono text-[0.75rem] text-gray-400">{formatTs(group.latestTimestamp)}</span>
              <span className="font-semibold tracking-[-0.01em]">
                {group.alertName}
                {group.alerts.length > 1 && (
                  <span className="font-mono text-[0.65rem] text-gray-400 bg-gray-100 px-2 py-0.5 ml-2 inline-block">
                    ×{group.alerts.length}
                  </span>
                )}
              </span>
              <span className={`font-mono text-[0.7rem] uppercase ${severityStyle[group.highestSeverity] || ''}`}>
                {group.highestSeverity}
              </span>
              <span className={`inline-block font-mono text-[0.65rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium ${outcomeBg[outcomeKey] || ''}`}>
                {group.alerts[0].outcome.replace('-', ' ')}
              </span>
            </div>

            {expandedGroup === group.alertName && (
              <div className="bg-surface border-l-[3px] border-l-accent slide-in">
                {group.alerts.map(a => (
                  <AlertRow
                    key={a.id}
                    alert={a}
                    expanded={expandedAlert === a.id}
                    onToggle={() => onToggleAlert(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
