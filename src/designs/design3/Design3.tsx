import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design3.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design3() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="warm-root">
      <header className="warm-header">
        <div className="warm-header-top">
          <div>
            <h1 className="warm-title">Cluster Alerts</h1>
            <div className="warm-subtitle">Kubernetes · Home Lab · Daily Log</div>
          </div>
          <Link to="/" className="warm-back">← back</Link>
        </div>
      </header>

      <div className="warm-controls">
        <div className="warm-date-section">
          <span className="warm-date-label">from</span>
          <input type="date" className="warm-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="warm-date-label">to</span>
          <input type="date" className="warm-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="warm-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`warm-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'all' : o}
            </button>
          ))}
        </div>
      </div>

      <div className="warm-layout">
        <div className="warm-alert-list">
          <div className="warm-alert-header-row">
            <span>Time</span>
            <span>Alert</span>
            <span>Sev.</span>
            <span>Namespace</span>
            <span>Node</span>
            <span>Outcome</span>
          </div>
          {alerts.map(a => (
            <div key={a.id} className={`warm-alert-item ${expandedId === a.id ? 'expanded' : ''}`}
              onClick={() => toggleExpanded(a.id)}>
              <div className="warm-alert-row">
                <span className="warm-ts">{formatTs(a.timestamp)}</span>
                <span className="warm-alert-name">{a.alertName}</span>
                <span className={`warm-sev ${a.severity}`}>{a.severity}</span>
                <span>{a.namespace}</span>
                <span className="warm-ts">{a.node}</span>
                <span className={`warm-badge ${a.outcome}`}>{a.outcome}</span>
              </div>
              {expandedId === a.id && (
                <div className="warm-detail">
                  <div className="warm-detail-block">
                    <div className="warm-detail-label">Summary</div>
                    <div className="warm-detail-text">{a.summary}</div>
                  </div>
                  <div className="warm-detail-block">
                    <div className="warm-detail-label">Root Cause</div>
                    <div className="warm-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="warm-detail-block">
                    <div className="warm-detail-label">Action Taken</div>
                    <div className="warm-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="warm-sidebar">
          <div className="warm-sidebar-title">Cluster Health</div>
          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="warm-node-card">
              <div className="warm-node-header">
                <span className="warm-node-name">{n.name}</span>
                <span className={n.status === 'Ready' ? 'warm-node-ready' : 'warm-node-notready'}>
                  {n.status}
                </span>
              </div>
              <div className="warm-meter-row">
                <span className="warm-meter-label">CPU</span>
                <div className="warm-meter-track">
                  <div className={`warm-meter-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
                </div>
                <span className="warm-meter-val">{n.cpu}%</span>
              </div>
              <div className="warm-meter-row">
                <span className="warm-meter-label">MEM</span>
                <div className="warm-meter-track">
                  <div className={`warm-meter-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
                </div>
                <span className="warm-meter-val">{n.memory}%</span>
              </div>
            </div>
          ))}

          <div className="warm-ceph-section">
            <div className="warm-sidebar-title">Ceph Storage</div>
            <div className={`warm-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="warm-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="warm-storage-info">
              {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="warm-meter-track">
              <div className={`warm-meter-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="warm-stats-row">
            <div className="warm-stat-item">
              <div className="warm-stat-num">{alerts.length}</div>
              <div className="warm-stat-label">Total</div>
            </div>
            <div className="warm-stat-item">
              <div className="warm-stat-num" style={{ color: 'var(--w-rust)' }}>
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="warm-stat-label">Critical</div>
            </div>
            <div className="warm-stat-item">
              <div className="warm-stat-num" style={{ color: 'var(--w-orange)' }}>
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="warm-stat-label">Escalated</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
