import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design9.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function Design9() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="s9-root">
      <header className="s9-header">
        <div className="s9-header-left">
          <h1>K8S ALERTS</h1>
          <div className="s9-header-stats">
            <span className="s9-stat">{alerts.length} alerts</span>
            <span className="s9-stat-sep">|</span>
            <span className="s9-stat s9-stat-crit">{alerts.filter(a => a.severity === 'critical').length} crit</span>
            <span className="s9-stat-sep">|</span>
            <span className="s9-stat">{alerts.filter(a => a.outcome === 'escalated').length} esc</span>
          </div>
        </div>
        <Link to="/" className="s9-back">← IDX</Link>
      </header>

      <div className="s9-controls">
        <div className="s9-date-section">
          <span className="s9-date-label">F</span>
          <input type="date" className="s9-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="s9-date-label">T</span>
          <input type="date" className="s9-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="s9-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`s9-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'ALL' : o === 'self-resolved' ? 'S-RES' : o.toUpperCase().slice(0, 4)}
            </button>
          ))}
        </div>
      </div>

      <div className="s9-main">
        <div className="s9-alert-list">
          <div className="s9-alert-header-row">
            <span>TIME</span>
            <span>ALERT</span>
            <span>S</span>
            <span>NS</span>
            <span>NODE</span>
            <span>OUT</span>
          </div>
          {alerts.map(a => (
            <div key={a.id}>
              <div className={`s9-alert-row ${expandedId === a.id ? 'expanded' : ''}`}
                onClick={() => toggleExpanded(a.id)}>
                <span className="s9-ts">{formatTs(a.timestamp)}</span>
                <span className="s9-name">{a.alertName}</span>
                <span className={`s9-severity ${a.severity}`}>
                  {a.severity === 'critical' ? 'C' : a.severity === 'warning' ? 'W' : 'I'}
                </span>
                <span className="s9-ns">{a.namespace}</span>
                <span className="s9-ts">{a.node}</span>
                <span className={`s9-badge ${a.outcome}`}>
                  {a.outcome === 'self-resolved' ? 'S-RES' : a.outcome === 'escalated' ? 'ESC' : a.outcome.toUpperCase().slice(0, 4)}
                </span>
              </div>
              {expandedId === a.id && (
                <div className="s9-detail">
                  <div className="s9-detail-row">
                    <div className="s9-detail-section">
                      <span className="s9-detail-label">SUM</span>
                      <span className="s9-detail-text">{a.summary}</span>
                    </div>
                    <div className="s9-detail-section">
                      <span className="s9-detail-label">ROOT</span>
                      <span className="s9-detail-text">{a.rootCause}</span>
                    </div>
                    <div className="s9-detail-section">
                      <span className="s9-detail-label">ACT</span>
                      <span className="s9-detail-text">{a.actionTaken}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="s9-sidebar">
          <div className="s9-sidebar-title">NODES</div>
          <div className="s9-nodes-compact">
            {clusterHealth.nodes.map(n => (
              <div key={n.name} className="s9-node">
                <span className="s9-node-name">{n.name.replace('k8s-', '')}</span>
                <span className={`s9-node-status ${n.status === 'Ready' ? 'ready' : 'notready'}`}>
                  {n.status === 'Ready' ? '●' : '○'}
                </span>
                <div className="s9-mini-bar">
                  <div className={`s9-mini-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
                </div>
                <span className="s9-mini-val">{n.cpu}</span>
                <div className="s9-mini-bar">
                  <div className={`s9-mini-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
                </div>
                <span className="s9-mini-val">{n.memory}</span>
              </div>
            ))}
          </div>

          <div className="s9-ceph-compact">
            <div className="s9-sidebar-title">CEPH</div>
            <div className="s9-ceph-row">
              <span className={`s9-ceph-dot ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>●</span>
              <span className="s9-ceph-label">{clusterHealth.cephStatus.replace('HEALTH_', '')}</span>
              <span className="s9-ceph-storage">{clusterHealth.storageUsed}/{clusterHealth.storageTotal}{clusterHealth.storageUnit}</span>
            </div>
            <div className="s9-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="s9-mini-bar" style={{ marginTop: 4 }}>
              <div className={`s9-mini-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="s9-count-row">
            <div className="s9-count-item">
              <span className="s9-count-num">{alerts.length}</span>
              <span className="s9-count-label">TOT</span>
            </div>
            <div className="s9-count-item">
              <span className="s9-count-num s9-crit-color">{alerts.filter(a => a.severity === 'critical').length}</span>
              <span className="s9-count-label">CRT</span>
            </div>
            <div className="s9-count-item">
              <span className="s9-count-num s9-esc-color">{alerts.filter(a => a.outcome === 'escalated').length}</span>
              <span className="s9-count-label">ESC</span>
            </div>
            <div className="s9-count-item">
              <span className="s9-count-num">{alerts.filter(a => a.outcome === 'fixed').length}</span>
              <span className="s9-count-label">FIX</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
