import { formatTs } from '../../lib/format';
import type { FixScope } from '../../types';

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

interface FixesListProps {
  fixes: ConvexFix[];
}

export default function FixesList({ fixes }: FixesListProps) {
  if (!fixes.length) return null;

  return (
    <div className="px-5 py-4 bg-surface border-t border-gray-100">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400 mb-4 pb-2 border-b-2 border-gray-200">
        Fixes Applied
      </div>

      {fixes.map(fix => (
        <div key={fix._id} className="mb-4 border-l-[3px] border-l-gray-200 pl-4 pb-3 last:mb-0 last:pb-0">
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

          <div className="text-[0.85rem] leading-relaxed text-gray-600 mb-1">
            {fix.description}
          </div>

          {fix.rootCause && (
            <div>
              <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-gray-400">Root cause: </span>
              <span className="text-[0.8rem] text-gray-600">{fix.rootCause}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
