import { useState, useEffect } from 'react';
import type { Alert } from '../../types';
import type { ClusterHealth as ClusterHealthType } from '../../types';
import { getConfig } from '../../lib/config';

interface ClusterHealthProps {
  health: ClusterHealthType;
  alerts: Alert[];
}

export default function ClusterHealth({ health, alerts }: ClusterHealthProps) {
  const storagePercent = (health.storageUsed / health.storageTotal) * 100;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cephDashboardUrl, setCephDashboardUrl] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then(c => setCephDashboardUrl(c.cephDashboardUrl ?? null));
  }, []);

  const content = (
    <>
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400 mb-6 pb-2 border-b-2 border-gray-200">
        Cluster Health
      </div>

      {health.nodes.map(n => (
        <div key={n.name} className="mb-5 pb-4 border-b border-gray-100 last:mb-0 last:pb-0 last:border-b-0">
          <div className="font-mono text-[0.75rem] mb-2 flex justify-between">
            <span>{n.name}</span>
            <span className={`font-bold ${n.status === 'Ready' ? 'text-outcome-fixed' : 'text-accent node-notready-glow'}`}>
              {n.status}
            </span>
          </div>
          <div className="h-1 bg-gray-100 mt-1.5">
            <div
              className={`h-full transition-[width] duration-500 ease-out ${n.cpu > 80 ? 'bg-accent bar-fill-high-glow' : 'bg-gray-400'}`}
              style={{ width: `${n.cpu}%` }}
            />
          </div>
          <div className="font-mono text-[0.6rem] text-gray-400 mt-1 flex justify-between">
            <span>CPU</span><span>{n.cpu}%</span>
          </div>
          <div className="h-1 bg-gray-100 mt-1.5">
            <div
              className={`h-full transition-[width] duration-500 ease-out ${n.memory > 80 ? 'bg-accent bar-fill-high-glow' : 'bg-gray-400'}`}
              style={{ width: `${n.memory}%` }}
            />
          </div>
          <div className="font-mono text-[0.6rem] text-gray-400 mt-1 flex justify-between">
            <span>MEM</span><span>{n.memory}%</span>
          </div>
        </div>
      ))}

      <div className="mt-6 pt-4 border-t-2 border-gray-200">
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400 mb-6 pb-2 border-b-2 border-gray-200">
          Ceph Storage
        </div>
        <div className={`text-[1.2rem] font-bold mb-1.5 ${
          health.cephStatus === 'HEALTH_OK' ? 'text-outcome-fixed' :
          health.cephStatus === 'HEALTH_WARN' ? 'text-escalated ceph-warn-glow' :
          'text-accent ceph-err-glow'
        }`}>
          {health.cephStatus.replace('HEALTH_', '')}
        </div>
        <div className="text-[0.8rem] text-gray-600 leading-[1.4] mb-3">
          {health.cephMessage}
          {health.cephStatus !== 'HEALTH_OK' && cephDashboardUrl && (
            <a
              href={cephDashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent mt-1.5 hover:underline"
            >
              Open Ceph Dashboard →
            </a>
          )}
        </div>
        <div className="font-mono text-[0.6rem] text-gray-400 uppercase tracking-[0.1em] mb-1.5">
          Storage: {health.storageUsed} / {health.storageTotal} {health.storageUnit}
        </div>
        <div className="h-1 bg-gray-100">
          <div
            className={`h-full transition-[width] duration-500 ease-out ${storagePercent > 80 ? 'bg-accent bar-fill-high-glow' : 'bg-gray-400'}`}
            style={{ width: `${storagePercent}%` }}
          />
        </div>
      </div>

      <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
        <div className="text-center">
          <div className="text-[1.8rem] font-bold leading-none">{alerts.length}</div>
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.12em] text-gray-400 mt-1">Total</div>
        </div>
        <div className="text-center">
          <div className="text-[1.8rem] font-bold leading-none text-accent critical-num-glow">
            {alerts.filter(a => a.severity === 'critical').length}
          </div>
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.12em] text-gray-400 mt-1">Critical</div>
        </div>
        <div className="text-center">
          <div className="text-[1.8rem] font-bold leading-none text-escalated">
            {alerts.filter(a => a.outcome === 'escalated').length}
          </div>
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.12em] text-gray-400 mt-1">Escalated</div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="border-l border-gray-200 py-[30px] px-10 bg-surface max-lg:hidden overflow-y-auto">
        {content}
      </aside>

      {/* Mobile bottom sheet */}
      <div className="hidden max-lg:block fixed bottom-0 left-0 right-0 z-50">
        {/* Tab handle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="w-full bg-surface border-t border-gray-200 px-5 py-3 flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400">
              Cluster Health
            </span>
            <span className={`font-mono text-[0.75rem] font-bold ${
              health.cephStatus === 'HEALTH_OK' ? 'text-outcome-fixed' : 'text-accent'
            }`}>
              {health.cephStatus.replace('HEALTH_', '')}
            </span>
            <span className="font-mono text-[0.65rem] text-gray-400">
              {health.nodes.filter(n => n.status === 'Ready').length}/{health.nodes.length} nodes
            </span>
          </div>
          <span className={`text-gray-400 text-[0.8rem] transition-transform duration-200 ${mobileOpen ? 'rotate-180' : ''}`}>
            ▲
          </span>
        </button>

        {/* Expandable panel */}
        <div
          className={`bg-surface border-t border-gray-200 overflow-y-auto transition-[max-height] duration-300 ease-in-out ${
            mobileOpen ? 'max-h-[70vh]' : 'max-h-0'
          }`}
        >
          <div className="px-5 py-6">
            {content}
          </div>
        </div>
      </div>

      {/* Spacer so alert list doesn't get hidden behind the fixed tab */}
      <div className="hidden max-lg:block h-[52px]" />
    </>
  );
}
