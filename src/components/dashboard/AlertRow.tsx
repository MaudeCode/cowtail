import type { Alert } from '../../types';
import AlertDetail from './AlertDetail';

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

interface AlertRowProps {
  alert: Alert;
  expanded: boolean;
  onToggle: () => void;
}

export default function AlertRow({ alert, expanded, onToggle }: AlertRowProps) {
  const outcomeKey = `outcome-${alert.outcome}` as keyof typeof outcomeBg;

  return (
    <div>
      <div
        className={`grid grid-cols-[120px_1fr_80px_100px_120px_110px] gap-3 py-3.5 pl-5 border-b cursor-pointer transition-[background] duration-100 items-center text-[0.85rem] hover:bg-[rgba(184,36,44,0.04)] max-md:grid-cols-[1fr_1fr] max-md:gap-x-3 max-md:gap-y-1 max-md:py-3 ${
          expanded ? 'border-b-accent bg-surface' : 'border-b-gray-100'
        }`}
        onClick={e => { e.stopPropagation(); onToggle(); }}
      >
        <span className="font-mono text-[0.75rem] text-gray-400">{formatTs(alert.timestamp)}</span>
        <span>{alert.namespace}</span>
        <span className={`font-mono text-[0.7rem] uppercase ${severityStyle[alert.severity] || ''}`}>
          {alert.severity}
        </span>
        <span className="font-mono text-[0.75rem] text-gray-400">{alert.node}</span>
        <span className="font-mono text-[0.75rem] text-gray-400">{alert.node}</span>
        <span className={`inline-block font-mono text-[0.65rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium ${outcomeBg[outcomeKey] || ''}`}>
          {alert.outcome.replace('-', ' ')}
        </span>
      </div>
      {expanded && <AlertDetail alert={alert} />}
    </div>
  );
}
