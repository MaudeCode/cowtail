import { useDashboard } from '../hooks/useDashboard';
import { useClusterHealth } from '../hooks/useClusterHealth';
import { StatsBar, DateRangeBar, AlertList, ClusterHealth } from '../components/dashboard';
import type { ClusterHealth as ClusterHealthType } from '../types';

const fallbackHealth: ClusterHealthType = {
  nodes: [],
  cephStatus: 'HEALTH_OK',
  cephMessage: 'Loading...',
  storageTotal: 1,
  storageUsed: 0,
  storageUnit: 'TiB',
};

export default function Dashboard() {
  const {
    alerts,
    groups,
    stats,
    outcomeFilter,
    setOutcomeFilter,
    datePreset,
    handlePreset,
    dateRange,
    handleDateChange,
    expandedGroup,
    toggleGroup,
    expandedAlert,
    toggleAlert,
  } = useDashboard();

  const { health: clusterHealth } = useClusterHealth();
  const healthData = clusterHealth ?? fallbackHealth;

  return (
    <div className="font-sans bg-bg text-txt h-screen flex flex-col overflow-hidden grid-bg">
      <header className="shrink-0 grid grid-cols-[1fr_auto] items-end px-10 pt-10 pb-5 border-b-2 border-gray-200 gap-5 header-glow max-lg:px-4 max-lg:pt-3 max-lg:pb-2">
        <div>
          <h1 className="text-5xl font-bold leading-none tracking-[-0.03em] uppercase text-txt max-lg:text-[1.4rem]">
            Cow<span className="text-accent title-glow">tail</span>
          </h1>
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-gray-400 mt-1 max-lg:hidden">
            Alert Investigation Log
          </div>
        </div>
      </header>

      <div className="shrink-0">
        <StatsBar
          stats={stats}
          activeOutcome={outcomeFilter}
          onOutcomeChange={setOutcomeFilter}
        />
      </div>

      <div className="shrink-0">
        <DateRangeBar
          datePreset={datePreset}
          dateRange={dateRange}
          onPreset={handlePreset}
          onDateChange={handleDateChange}
        />
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-[1fr_320px] max-lg:grid-cols-1">
        <div className="overflow-y-auto min-h-0">
          <AlertList
            groups={groups}
            expandedGroup={expandedGroup}
            expandedAlert={expandedAlert}
            onToggleGroup={toggleGroup}
            onToggleAlert={toggleAlert}
          />
        </div>
        <ClusterHealth health={healthData} alerts={alerts} />
      </div>
    </div>
  );
}
