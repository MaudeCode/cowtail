import { useState } from 'react';
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

type SortField = 'time' | 'alert' | 'severity' | 'outcome';
type SortDir = 'asc' | 'desc';

const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const outcomeOrder: Record<string, number> = { escalated: 0, fixed: 1, 'self-resolved': 2, noise: 3 };

function sortGroups(groups: AlertGroup[], field: SortField, dir: SortDir): AlertGroup[] {
  return [...groups].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'time':
        cmp = new Date(a.latestTimestamp).getTime() - new Date(b.latestTimestamp).getTime();
        break;
      case 'alert':
        cmp = a.alertName.localeCompare(b.alertName);
        break;
      case 'severity':
        cmp = (severityOrder[a.highestSeverity] ?? 99) - (severityOrder[b.highestSeverity] ?? 99);
        break;
      case 'outcome':
        cmp = (outcomeOrder[a.alerts[0].outcome] ?? 99) - (outcomeOrder[b.alerts[0].outcome] ?? 99);
        break;
    }
    return dir === 'desc' ? -cmp : cmp;
  });
}

const cols = 'grid grid-cols-[120px_1fr_80px_110px] gap-3';

interface AlertListProps {
  groups: AlertGroup[];
  expandedGroup: string | null;
  expandedAlert: string | null;
  onToggleGroup: (name: string) => void;
  onToggleAlert: (id: string) => void;
}

export default function AlertList({ groups, expandedGroup, expandedAlert, onToggleGroup, onToggleAlert }: AlertListProps) {
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedGroups = sortGroups(groups, sortField, sortDir);
  const arrow = (field: SortField) => sortField === field ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div className="px-10 max-lg:px-4">
      {/* Desktop header */}
      <div className={`${cols} py-3.5 border-b-2 border-gray-200 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-gray-400 max-lg:hidden`}>
        <span className="cursor-pointer hover:text-txt select-none" onClick={() => handleSort('time')}>Time{arrow('time')}</span>
        <span className="cursor-pointer hover:text-txt select-none" onClick={() => handleSort('alert')}>Alert{arrow('alert')}</span>
        <span className="cursor-pointer hover:text-txt select-none" onClick={() => handleSort('severity')}>Severity{arrow('severity')}</span>
        <span className="cursor-pointer hover:text-txt select-none" onClick={() => handleSort('outcome')}>Outcome{arrow('outcome')}</span>
      </div>

      {sortedGroups.length === 0 && (
        <div className="py-16 text-center text-gray-400 font-mono text-[0.85rem] uppercase tracking-[0.08em]">
          No alerts match the current filters
        </div>
      )}

      {sortedGroups.map(group => {
        const outcomeKey = `outcome-${group.alerts[0].outcome}` as keyof typeof outcomeBg;
        return (
          <div key={group.alertName}>
            {/* Desktop row */}
            <div
              className={`${cols} py-3.5 border-b cursor-pointer transition-[background] duration-100 items-center text-[0.85rem] hover:bg-[rgba(184,36,44,0.04)] max-lg:hidden ${
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

            {/* Mobile card */}
            <div
              className={`hidden max-lg:block py-3 px-3 border-b cursor-pointer transition-[background] duration-100 hover:bg-[rgba(184,36,44,0.04)] ${
                expandedGroup === group.alertName ? 'border-b-accent bg-surface' : 'border-b-gray-100'
              }`}
              onClick={() => onToggleGroup(group.alertName)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-[0.85rem] tracking-[-0.01em] truncate mr-2">
                  {group.alertName}
                </span>
                <span className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium shrink-0 ${outcomeBg[outcomeKey] || ''}`}>
                  {group.alerts[0].outcome.replace('-', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[0.7rem] text-gray-400">
                <span>{formatTs(group.latestTimestamp)}</span>
                <span className={`uppercase ${severityStyle[group.highestSeverity] || ''}`}>
                  {group.highestSeverity}
                </span>
                {group.alerts.length > 1 && (
                  <span className="bg-gray-100 px-1.5 py-0.5 text-[0.6rem]">×{group.alerts.length}</span>
                )}
              </div>
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
