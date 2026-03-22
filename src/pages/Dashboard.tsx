import { useDashboard } from '../hooks/useDashboard';
import { clusterHealth } from '../data/mockAlerts';
import { StatsBar, DateRangeBar, AlertList, ClusterHealth } from '../components/dashboard';

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

  return (
    <div className="font-sans bg-bg text-txt min-h-screen grid-bg">
      <header className="grid grid-cols-[1fr_auto] items-end px-10 pt-10 pb-5 border-b-2 border-gray-200 gap-5 header-glow max-md:px-5 max-md:pt-6 max-md:pb-4">
        <div>
          <h1 className="text-5xl font-bold leading-none tracking-[-0.03em] uppercase text-txt max-md:text-[1.8rem]">
            K8s <span className="text-accent title-glow">Alerts</span>
          </h1>
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-gray-400 mt-1">
            Cluster Alert History
          </div>
        </div>
      </header>

      <StatsBar
        stats={stats}
        activeOutcome={outcomeFilter}
        onOutcomeChange={setOutcomeFilter}
      />

      <DateRangeBar
        datePreset={datePreset}
        dateRange={dateRange}
        onPreset={handlePreset}
        onDateChange={handleDateChange}
      />

      <div className="grid grid-cols-[1fr_320px] min-h-[calc(100vh-200px)] max-md:grid-cols-1">
        <AlertList
          groups={groups}
          expandedGroup={expandedGroup}
          expandedAlert={expandedAlert}
          onToggleGroup={toggleGroup}
          onToggleAlert={toggleAlert}
        />
        <ClusterHealth health={clusterHealth} alerts={alerts} />
      </div>
    </div>
  );
}
