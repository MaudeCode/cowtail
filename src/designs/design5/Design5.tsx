import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design5.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design5() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="memphis-root">
      <header className="memphis-header">
        <h1 className="memphis-title">
          <span className="k8s">K8s</span> <span className="alerts">Alerts</span>
        </h1>
        <Link to="/" className="memphis-back">← BACK</Link>
      </header>

      <div className="memphis-controls">
        <div className="memphis-date-section">
          <span className="memphis-date-label">From</span>
          <input type="date" className="memphis-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="memphis-date-label">To</span>
          <input type="date" className="memphis-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="memphis-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`memphis-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'ALL' : o.toUpperCase().replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="memphis-layout">
        <div className="memphis-alert-list">
          {alerts.map(a => (
            <div key={a.id} className={`memphis-alert-card ${expandedId === a.id ? 'expanded' : ''}`}
              onClick={() => toggleExpanded(a.id)}>
              <div className="memphis-alert-row">
                <span className="memphis-ts">{formatTs(a.timestamp)}</span>
                <span className="memphis-alert-name">{a.alertName}</span>
                <span className={`memphis-sev ${a.severity}`}>{a.severity}</span>
                <span>{a.namespace}</span>
                <span className="memphis-ts">{a.node}</span>
                <span className={`memphis-badge ${a.outcome}`}>{a.outcome.replace('-', ' ')}</span>
              </div>
              {expandedId === a.id && (
                <div className="memphis-detail">
                  <div className="memphis-detail-block">
                    <div className="memphis-detail-label">Summary</div>
                    <div className="memphis-detail-text">{a.summary}</div>
                  </div>
                  <div className="memphis-detail-block">
                    <div className="memphis-detail-label">Root Cause</div>
                    <div className="memphis-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="memphis-detail-block">
                    <div className="memphis-detail-label">Action Taken</div>
                    <div className="memphis-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="memphis-sidebar">
          <div className="memphis-sidebar-title">Cluster Health</div>
          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="memphis-node-card">
              <div className="memphis-node-header">
                <span className="memphis-node-name">{n.name}</span>
                <span className={n.status === 'Ready' ? 'memphis-node-ready' : 'memphis-node-notready'}>
                  {n.status}
                </span>
              </div>
              <div className="memphis-bar-row">
                <span className="memphis-bar-label">CPU</span>
                <div className="memphis-bar-track">
                  <div className={`memphis-bar-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
                </div>
                <span className="memphis-bar-val">{n.cpu}%</span>
              </div>
              <div className="memphis-bar-row">
                <span className="memphis-bar-label">MEM</span>
                <div className="memphis-bar-track">
                  <div className={`memphis-bar-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
                </div>
                <span className="memphis-bar-val">{n.memory}%</span>
              </div>
            </div>
          ))}

          <div className="memphis-ceph-section">
            <div className="memphis-sidebar-title">Ceph Storage</div>
            <div className={`memphis-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="memphis-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="memphis-storage-info">
              {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="memphis-bar-track">
              <div className={`memphis-bar-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="memphis-stats-row">
            <div className="memphis-stat-item">
              <div className="memphis-stat-num">{alerts.length}</div>
              <div className="memphis-stat-label">Total</div>
            </div>
            <div className="memphis-stat-item">
              <div className="memphis-stat-num" style={{ color: 'var(--m-pink)' }}>
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="memphis-stat-label">Critical</div>
            </div>
            <div className="memphis-stat-item">
              <div className="memphis-stat-num" style={{ color: 'var(--m-orange)' }}>
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="memphis-stat-label">Escalated</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
