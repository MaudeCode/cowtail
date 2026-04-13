import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import { formatTs } from '../lib/format';
import { BuildVersion } from '../components/ui';
import type { FixScope } from '../types';

interface ConvexFix {
  _id: string;
  _creationTime: number;
  timestamp: number;
  alertIds: string[];
  description: string;
  rootCause: string;
  commit?: string;
  scope: FixScope;
}

const scopeStyle: Record<FixScope, { bg: string; numColor: string; borderColor: string; activeBg: string }> = {
  reactive: {
    bg: 'bg-outcome-fixed',
    numColor: 'text-outcome-fixed',
    borderColor: 'border-b-outcome-fixed',
    activeBg: 'bg-[rgba(45,155,82,0.08)]',
  },
  weekly: {
    bg: 'bg-[#3b82f6]',
    numColor: 'text-[#3b82f6]',
    borderColor: 'border-b-[#3b82f6]',
    activeBg: 'bg-[rgba(59,130,246,0.08)]',
  },
  monthly: {
    bg: 'bg-[#8b5cf6]',
    numColor: 'text-[#8b5cf6]',
    borderColor: 'border-b-[#8b5cf6]',
    activeBg: 'bg-[rgba(139,92,246,0.08)]',
  },
};

type ScopeFilter = FixScope | 'all';

const statsItems: Array<{
  key: ScopeFilter;
  label: string;
  shortLabel: string;
  numColor: string;
  activeBorderColor: string;
  activeBg: string;
}> = [
  { key: 'all', label: 'Total', shortLabel: 'All', numColor: '', activeBorderColor: 'border-b-accent', activeBg: 'bg-glow' },
  { key: 'reactive', label: 'Reactive', shortLabel: 'React', numColor: 'text-outcome-fixed', activeBorderColor: 'border-b-outcome-fixed', activeBg: 'bg-[rgba(45,155,82,0.08)]' },
  { key: 'weekly', label: 'Weekly', shortLabel: 'Wkly', numColor: 'text-[#3b82f6]', activeBorderColor: 'border-b-[#3b82f6]', activeBg: 'bg-[rgba(59,130,246,0.08)]' },
  { key: 'monthly', label: 'Monthly', shortLabel: 'Mnth', numColor: 'text-[#8b5cf6]', activeBorderColor: 'border-b-[#8b5cf6]', activeBg: 'bg-[rgba(139,92,246,0.08)]' },
];

export default function Fixes() {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');

  const { data: convexFixes, isPending } = useQuery(
    convexQuery(api.fixes.getAll, {})
  );

  const allFixes = (convexFixes as ConvexFix[] | undefined) ?? [];

  const stats = {
    all: allFixes.length,
    reactive: allFixes.filter(f => f.scope === 'reactive').length,
    weekly: allFixes.filter(f => f.scope === 'weekly').length,
    monthly: allFixes.filter(f => f.scope === 'monthly').length,
  };

  const fixes = allFixes
    .filter(f => scopeFilter === 'all' || f.scope === scopeFilter)
    .sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="font-sans bg-bg text-txt min-h-screen grid-bg">
      {/* Header */}
      <header className="shrink-0 flex items-end justify-between px-10 pt-10 pb-5 border-b-2 border-gray-200 header-glow max-lg:px-4 max-lg:pt-3 max-lg:pb-2">
        <div>
          <h1 className="text-5xl font-bold leading-none tracking-[-0.03em] uppercase text-txt max-lg:text-[1.4rem]">
            Cow<span className="text-accent title-glow">tail</span>
            <span className="text-gray-400 font-normal text-lg ml-3 max-lg:text-sm max-lg:ml-2">Fixes</span>
          </h1>
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-gray-400 mt-1 max-lg:hidden">
            Applied Remediations
            <BuildVersion />
          </div>
        </div>
        <a href="/" className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-gray-400 hover:text-accent transition-colors pb-1">
          ← Dashboard
        </a>
      </header>

      {/* Stats bar — doubles as scope filter */}
      <div className="flex border-b border-gray-200">
        {statsItems.map(({ key, label, shortLabel, numColor, activeBorderColor, activeBg }) => {
          const isActive = scopeFilter === key;
          return (
            <div
              key={key}
              className={`flex-1 px-6 py-4 border-r border-gray-100 text-center cursor-pointer transition-all duration-150 bg-surface border-b-2 border-b-transparent last:border-r-0 hover:bg-[rgba(255,255,255,0.02)] max-lg:px-2 max-lg:py-2 ${isActive ? `${activeBorderColor} ${activeBg}` : ''}`}
              onClick={() => setScopeFilter(key)}
            >
              <div className={`text-[1.8rem] font-bold leading-none max-lg:text-[1.1rem] ${numColor}`}>
                {stats[key]}
              </div>
              <div className={`font-mono text-[0.55rem] uppercase tracking-[0.12em] mt-1 max-lg:text-[0.5rem] max-lg:tracking-[0.05em] ${isActive ? 'text-txt' : 'text-gray-400'}`}>
                <span className="max-lg:hidden">{label}</span>
                <span className="hidden max-lg:inline">{shortLabel}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="max-w-[960px] mx-auto px-10 py-8 max-lg:px-4 max-lg:py-4">
        {isPending ? (
          <div className="text-gray-400 font-mono text-sm py-20 text-center">Loading...</div>
        ) : fixes.length === 0 ? (
          <div className="text-center py-20 text-gray-400 font-mono text-sm uppercase tracking-wider">
            No fixes{scopeFilter !== 'all' ? ` with scope "${scopeFilter}"` : ''}
          </div>
        ) : (
          <>
            {/* Section header */}
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-gray-400 border-b-2 border-gray-200 pb-2 mb-6">
              {scopeFilter === 'all' ? 'All Fixes' : `${scopeFilter} Fixes`}{' '}
              <span className="text-txt">({fixes.length})</span>
            </div>

            {/* Card grid */}
            <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
              {fixes.map(fix => {
                const style = scopeStyle[fix.scope];
                return (
                  <div
                    key={fix._id}
                    className="bg-surface border-l-[3px] border-l-gray-200 hover:border-l-accent transition-colors duration-150 p-4"
                  >
                    {/* Top row: scope badge + date + commit */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[2px] font-medium text-white ${style.bg}`}>
                        {fix.scope}
                      </span>
                      <span className="font-mono text-[0.65rem] text-gray-400">
                        {formatTs(new Date(fix.timestamp).toISOString())}
                      </span>
                      {fix.commit && (
                        <span className="font-mono text-[0.6rem] text-gray-400 bg-bg px-1.5 py-0.5 ml-auto">
                          {fix.commit.slice(0, 7)}
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <div className="text-[0.85rem] leading-relaxed text-txt mb-2">
                      {fix.description}
                    </div>

                    {/* Root cause */}
                    {fix.rootCause && (
                      <div className="mb-2">
                        <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">Root cause </span>
                        <span className="text-[0.8rem] text-gray-400 leading-snug">{fix.rootCause}</span>
                      </div>
                    )}

                    {/* Alert count */}
                    {fix.alertIds.length > 0 && (
                      <div className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-gray-400 mt-auto pt-1 border-t border-gray-100">
                        {fix.alertIds.length} alert{fix.alertIds.length !== 1 ? 's' : ''} linked
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 mt-8 text-center">
              <a href="/" className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-accent hover:text-txt transition-colors">
                ← View Dashboard
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
