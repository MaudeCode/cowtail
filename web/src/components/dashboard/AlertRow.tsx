import { formatTs } from '../../lib/format';
import type { Alert } from '../../types';
import AlertDetail from './AlertDetail';


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
  showDetail?: boolean;
  onToggle?: () => void;
}

export default function AlertRow({ alert, showDetail = false, onToggle }: AlertRowProps) {
  const outcomeKey = `outcome-${alert.outcome}` as keyof typeof outcomeBg;

  return (
    <div>
      {/* Desktop row */}
      <div
        className={`grid grid-cols-[120px_1fr_80px_110px] gap-3 py-3.5 pl-5 border-b items-center text-[0.85rem] max-lg:hidden ${
          onToggle ? 'cursor-pointer hover:bg-[rgba(184,36,44,0.04)] transition-[background] duration-100' : ''
        } ${showDetail ? 'border-b-accent bg-surface' : 'border-b-gray-100'}`}
        onClick={e => { if (onToggle) { e.stopPropagation(); onToggle(); } }}
      >
        <span className="font-mono text-[0.75rem] text-gray-400">{formatTs(alert.timestamp)}</span>
        <span className="text-gray-600">{alert.namespace}{alert.node ? ` · ${alert.node}` : ''}</span>
        <span className={`font-mono text-[0.7rem] uppercase ${severityStyle[alert.severity] || ''}`}>
          {alert.severity}
        </span>
        <span className={`inline-block font-mono text-[0.65rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium ${outcomeBg[outcomeKey] || ''}`}>
          {alert.outcome.replace('-', ' ')}
        </span>
      </div>

      {/* Mobile row */}
      <div
        className={`hidden max-lg:block py-3 px-3 pl-5 border-b ${
          onToggle ? 'cursor-pointer hover:bg-[rgba(184,36,44,0.04)] transition-[background] duration-100' : ''
        } ${showDetail ? 'border-b-accent bg-surface' : 'border-b-gray-100'}`}
        onClick={e => { if (onToggle) { e.stopPropagation(); onToggle(); } }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[0.75rem] text-gray-400">{formatTs(alert.timestamp)}</span>
          <span className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium shrink-0 ${outcomeBg[outcomeKey] || ''}`}>
            {alert.outcome.replace('-', ' ')}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[0.7rem] text-gray-400">
          <span>{alert.namespace}</span>
          {alert.node && <span>{alert.node}</span>}
          <span className={`uppercase ${severityStyle[alert.severity] || ''}`}>{alert.severity}</span>
        </div>
      </div>

      {showDetail && <AlertDetail alert={alert} />}
    </div>
  );
}
