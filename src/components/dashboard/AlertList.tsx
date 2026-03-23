import { formatTs } from '../../lib/format';
import { useState } from 'react';
import type { AlertGroup } from '../../hooks/useDashboard';
import AlertRow from './AlertRow';
import AlertDetail from './AlertDetail';
import FixesList from './FixesList';
import { useFixes } from '../../hooks/useFixes';

function WrenchIcon() {
  return (
    <svg className="inline-block w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
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

interface AlertGroupRowProps {
  group: AlertGroup;
  isExpanded: boolean;
  expandedAlert: string | null;
  onToggleGroup: (name: string) => void;
  onToggleAlert: (id: string) => void;
}

function AlertGroupRow({ group, isExpanded, expandedAlert, onToggleGroup, onToggleAlert }: AlertGroupRowProps) {
  const alertIds = group.alerts.map(a => a.id);
  const { fixes } = useFixes(alertIds);
  const hasFixes = fixes.length > 0;

  const outcomeKey = `outcome-${group.alerts[0].outcome}` as keyof typeof outcomeBg;
  const isSingle = group.alerts.length === 1;
  const alert = group.alerts[0];

  return (
    <div>
      {/* Desktop row */}
      <div
        className={`${cols} py-3.5 border-b cursor-pointer transition-[background] duration-100 items-center text-[0.85rem] hover:bg-[rgba(184,36,44,0.04)] max-lg:hidden ${
          isExpanded ? 'border-b-accent bg-surface' : 'border-b-gray-100'
        }`}
        onClick={() => onToggleGroup(group.alertName)}
      >
        <span className="font-mono text-[0.75rem] text-gray-400">{formatTs(group.latestTimestamp)}</span>
        <span className="font-semibold tracking-[-0.01em] flex items-center gap-1.5">
          <span className="truncate">{group.alertName}</span>
          {hasFixes && <span className="text-accent shrink-0" title="Has fixes applied"><WrenchIcon /></span>}
          {!isSingle && (
            <span className="font-mono text-[0.65rem] text-gray-400 bg-gray-100 px-2 py-0.5 ml-2 inline-block">
              ×{group.alerts.length}
            </span>
          )}
        </span>
        <span className={`font-mono text-[0.7rem] uppercase ${severityStyle[group.highestSeverity] || ''}`}>
          {group.highestSeverity}
        </span>
        <span className={`inline-block font-mono text-[0.65rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium ${outcomeBg[outcomeKey] || ''}`}>
          {alert.outcome.replace('-', ' ')}
        </span>
      </div>

      {/* Mobile card */}
      <div
        className={`hidden max-lg:block py-3 px-3 border-b cursor-pointer transition-[background] duration-100 hover:bg-[rgba(184,36,44,0.04)] ${
          isExpanded ? 'border-b-accent bg-surface' : 'border-b-gray-100'
        }`}
        onClick={() => onToggleGroup(group.alertName)}
      >
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="font-semibold text-[0.85rem] tracking-[-0.01em] truncate">
            {group.alertName}
          </span>
          {hasFixes && <span className="text-accent shrink-0" title="Has fixes applied"><WrenchIcon /></span>}
          <span className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[3px] font-medium shrink-0 ${outcomeBg[outcomeKey] || ''}`}>
            {alert.outcome.replace('-', ' ')}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[0.7rem] text-gray-400">
          <span>{formatTs(group.latestTimestamp)}</span>
          <span className={`uppercase ${severityStyle[group.highestSeverity] || ''}`}>
            {group.highestSeverity}
          </span>
          {!isSingle && (
            <span className="bg-gray-100 px-1.5 py-0.5 text-[0.6rem]">×{group.alerts.length}</span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="bg-surface slide-in">
          {isSingle ? (
            <AlertDetail alert={alert} />
          ) : (
            group.alerts.map(a => (
              <AlertRow
                key={a.id}
                alert={a}
                showDetail={expandedAlert === a.id}
                onToggle={() => onToggleAlert(a.id)}
              />
            ))
          )}
          <FixesList fixes={fixes} />
        </div>
      )}
    </div>
  );
}

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

      {sortedGroups.map(group => (
        <AlertGroupRow
          key={group.alertName}
          group={group}
          isExpanded={expandedGroup === group.alertName}
          expandedAlert={expandedAlert}
          onToggleGroup={onToggleGroup}
          onToggleAlert={onToggleAlert}
        />
      ))}
    </div>
  );
}
