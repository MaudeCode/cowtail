import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import { formatTs } from '../lib/format';
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

const scopeStyle: Record<FixScope, string> = {
  reactive: 'bg-outcome-fixed text-white',
  weekly: 'bg-[#3b82f6] text-white',
  monthly: 'bg-[#8b5cf6] text-white',
};

const scopes: FixScope[] = ['reactive', 'weekly', 'monthly'];

export default function Fixes() {
  const [scopeFilter, setScopeFilter] = useState<FixScope | 'all'>('all');

  const { data: convexFixes, isPending } = useQuery(
    convexQuery(api.fixes.getAll, {})
  );

  const fixes = ((convexFixes as ConvexFix[] | undefined) ?? []).filter(
    f => scopeFilter === 'all' || f.scope === scopeFilter
  );

  return (
    <div className="font-sans bg-bg text-txt min-h-screen grid-bg">
      <div className="max-w-[700px] mx-auto px-6 py-10 max-lg:px-4 max-lg:py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-[-0.03em] uppercase max-lg:text-2xl">
            Cow<span className="text-accent title-glow">tail</span>
            <span className="text-gray-400 font-normal text-lg ml-3 max-lg:text-sm max-lg:ml-2">Fixes</span>
          </h1>
        </div>

        {/* Scope filter */}
        <div className="flex gap-px mb-8">
          <button
            onClick={() => setScopeFilter('all')}
            className={`font-mono text-[0.65rem] uppercase tracking-[0.08em] px-4 py-2.5 transition-colors cursor-pointer ${
              scopeFilter === 'all'
                ? 'bg-gray-200 text-txt font-bold'
                : 'bg-surface text-gray-400 hover:text-txt'
            }`}
          >
            All
          </button>
          {scopes.map(scope => (
            <button
              key={scope}
              onClick={() => setScopeFilter(scope)}
              className={`font-mono text-[0.65rem] uppercase tracking-[0.08em] px-4 py-2.5 transition-colors cursor-pointer ${
                scopeFilter === scope
                  ? 'bg-gray-200 text-txt font-bold'
                  : 'bg-surface text-gray-400 hover:text-txt'
              }`}
            >
              {scope}
            </button>
          ))}
        </div>

        {isPending ? (
          <div className="text-gray-400 font-mono text-sm py-20 text-center">Loading...</div>
        ) : fixes.length === 0 ? (
          <div className="text-center py-20 text-gray-400 font-mono text-sm uppercase tracking-wider">
            No fixes{scopeFilter !== 'all' ? ` with scope "${scopeFilter}"` : ''}
          </div>
        ) : (
          <>
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-gray-400 border-b-2 border-gray-200 pb-2 mb-4">
              Fixes <span className="text-txt">({fixes.length})</span>
            </div>

            {fixes.map(fix => (
              <div key={fix._id} className="mb-4 border-l-[3px] border-l-gray-200 pl-4 pb-4 last:pb-0 hover:border-l-accent transition-colors duration-150">
                <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                  <span className={`inline-block font-mono text-[0.6rem] uppercase tracking-[0.08em] whitespace-nowrap px-2 py-[2px] font-medium ${scopeStyle[fix.scope]}`}>
                    {fix.scope}
                  </span>
                  <span className="font-mono text-[0.65rem] text-gray-400">
                    {formatTs(new Date(fix.timestamp).toISOString())}
                  </span>
                  {fix.commit && (
                    <span className="font-mono text-[0.65rem] text-gray-400 bg-gray-100 px-1.5 py-0.5">
                      {fix.commit.slice(0, 7)}
                    </span>
                  )}
                </div>

                <div className="text-[0.9rem] leading-relaxed text-gray-600 mb-1">
                  {fix.description}
                </div>

                {fix.rootCause && (
                  <div className="mt-1">
                    <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">Root cause: </span>
                    <span className="text-[0.8rem] text-gray-600">{fix.rootCause}</span>
                  </div>
                )}

                {fix.alertIds.length > 0 && (
                  <div className="mt-1">
                    <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">Alerts: </span>
                    <span className="font-mono text-[0.7rem] text-gray-400">
                      {fix.alertIds.length} alert{fix.alertIds.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            ))}

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
