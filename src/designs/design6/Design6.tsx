import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design6.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design6() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="s6-root">
      <header className="s6-header">
        <h1>K8s <span>Alerts</span></h1>
        <Link to="/" className="s6-back">← Index</Link>
      </header>

      <div className="s6-controls">
        <div className="s6-date-section">
          <span className="s6-date-label">From</span>
          <input type="date" className="s6-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="s6-date-label">To</span>
          <input type="date" className="s6-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="s6-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`s6-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'All' : o.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="s6-main">
        <div className="s6-alert-list">
          <div className="s6-alert-header-row">
            <span>Time</span>
            <span>Alert</span>
            <span>Severity</span>
            <span>Namespace</span>
            <span>Node</span>
            <span>Outcome</span>
          </div>
          {alerts.map(a => (
            <div key={a.id}>
              <div className={`s6-alert-row ${expandedId === a.id ? 'expanded' : ''}`}
                onClick={() => toggleExpanded(a.id)}>
                <span className="s6-ts">{formatTs(a.timestamp)}</span>
                <span className="s6-name">{a.alertName}</span>
                <span className={`s6-severity ${a.severity}`}>{a.severity}</span>
                <span>{a.namespace}</span>
                <span className="s6-ts">{a.node}</span>
                <span className={`s6-badge ${a.outcome}`}>{a.outcome.replace('-', ' ')}</span>
              </div>
              {expandedId === a.id && (
                <div className="s6-detail">
                  <div className="s6-detail-section">
                    <div className="s6-detail-label">Summary</div>
                    <div className="s6-detail-text">{a.summary}</div>
                  </div>
                  <div className="s6-detail-section">
                    <div className="s6-detail-label">Root Cause</div>
                    <div className="s6-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="s6-detail-section">
                    <div className="s6-detail-label">Action Taken</div>
                    <div className="s6-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="s6-sidebar">
          <div className="s6-sidebar-title">Cluster Health</div>

          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="s6-node">
              <div className="s6-node-name">
                <span>{n.name}</span>
                <span className={`s6-node-status ${n.status === 'Ready' ? 'ready' : 'notready'}`}>
                  {n.status}
                </span>
              </div>
              <div className="s6-bar-track">
                <div className={`s6-bar-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
              </div>
              <div className="s6-bar-label"><span>CPU</span><span>{n.cpu}%</span></div>
              <div className="s6-bar-track">
                <div className={`s6-bar-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
              </div>
              <div className="s6-bar-label"><span>MEM</span><span>{n.memory}%</span></div>
            </div>
          ))}

          <div className="s6-ceph">
            <div className="s6-sidebar-title">Ceph Storage</div>
            <div className={`s6-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="s6-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="s6-storage-label">
              Storage: {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="s6-bar-track">
              <div className={`s6-bar-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="s6-count-row">
            <div className="s6-count-item">
              <div className="s6-count-num">{alerts.length}</div>
              <div className="s6-count-label">Total</div>
            </div>
            <div className="s6-count-item">
              <div className="s6-count-num s6-critical-num">
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="s6-count-label">Critical</div>
            </div>
            <div className="s6-count-item">
              <div className="s6-count-num s6-escalated-num">
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="s6-count-label">Escalated</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
