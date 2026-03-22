import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design7.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design7() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="s7-root">
      <header className="s7-header">
        <h1>K8s<br /><span>Alerts</span></h1>
        <Link to="/" className="s7-back">← Index</Link>
      </header>

      <div className="s7-controls">
        <div className="s7-date-section">
          <span className="s7-date-label">From</span>
          <input type="date" className="s7-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="s7-date-label">To</span>
          <input type="date" className="s7-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="s7-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`s7-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'All' : o.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="s7-main">
        <div className="s7-alert-list">
          <div className="s7-alert-header-row">
            <span>Time</span>
            <span>Alert</span>
            <span>Severity</span>
            <span>Namespace</span>
            <span>Outcome</span>
          </div>
          {alerts.map(a => (
            <div key={a.id}>
              <div className={`s7-alert-row ${expandedId === a.id ? 'expanded' : ''}`}
                onClick={() => toggleExpanded(a.id)}>
                <span className="s7-ts">{formatTs(a.timestamp)}</span>
                <span className="s7-name">{a.alertName}</span>
                <span className={`s7-severity ${a.severity}`}>{a.severity}</span>
                <span className="s7-ns">{a.namespace}</span>
                <span className={`s7-badge ${a.outcome}`}>{a.outcome.replace('-', ' ')}</span>
              </div>
              {expandedId === a.id && (
                <div className="s7-detail">
                  <div className="s7-detail-grid">
                    <div className="s7-detail-section">
                      <div className="s7-detail-label">Summary</div>
                      <div className="s7-detail-text">{a.summary}</div>
                    </div>
                    <div className="s7-detail-section">
                      <div className="s7-detail-label">Root Cause</div>
                      <div className="s7-detail-text">{a.rootCause}</div>
                    </div>
                    <div className="s7-detail-section">
                      <div className="s7-detail-label">Action Taken</div>
                      <div className="s7-detail-text">{a.actionTaken}</div>
                    </div>
                  </div>
                  <div className="s7-detail-meta">
                    <span>Node: {a.node}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="s7-sidebar">
          <div className="s7-sidebar-title">Cluster Health</div>

          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="s7-node">
              <div className="s7-node-name">
                <span>{n.name}</span>
                <span className={`s7-node-status ${n.status === 'Ready' ? 'ready' : 'notready'}`}>
                  {n.status}
                </span>
              </div>
              <div className="s7-bar-row">
                <div className="s7-bar-track">
                  <div className={`s7-bar-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
                </div>
                <span className="s7-bar-val">{n.cpu}%</span>
              </div>
              <div className="s7-bar-row">
                <div className="s7-bar-track">
                  <div className={`s7-bar-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
                </div>
                <span className="s7-bar-val">{n.memory}%</span>
              </div>
            </div>
          ))}

          <div className="s7-ceph">
            <div className="s7-sidebar-title">Ceph Storage</div>
            <div className={`s7-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="s7-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="s7-storage-label">
              {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="s7-bar-row">
              <div className="s7-bar-track">
                <div className={`s7-bar-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                  style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="s7-count-row">
            <div className="s7-count-item">
              <div className="s7-count-num">{alerts.length}</div>
              <div className="s7-count-label">Total</div>
            </div>
            <div className="s7-count-item">
              <div className="s7-count-num s7-critical-num">
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="s7-count-label">Critical</div>
            </div>
            <div className="s7-count-item">
              <div className="s7-count-num s7-escalated-num">
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="s7-count-label">Escalated</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
