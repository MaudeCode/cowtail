import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design1.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design1() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="swiss-root">
      <header className="swiss-header">
        <h1>K8s <span>Alerts</span></h1>
        <Link to="/" className="swiss-back">← Index</Link>
      </header>

      <div className="swiss-controls">
        <div className="swiss-date-section">
          <span className="swiss-date-label">From</span>
          <input type="date" className="swiss-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="swiss-date-label">To</span>
          <input type="date" className="swiss-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="swiss-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`swiss-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'All' : o.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="swiss-main">
        <div className="swiss-alert-list">
          <div className="swiss-alert-header-row">
            <span>Time</span>
            <span>Alert</span>
            <span>Severity</span>
            <span>Namespace</span>
            <span>Node</span>
            <span>Outcome</span>
          </div>
          {alerts.map(a => (
            <div key={a.id}>
              <div className={`swiss-alert-row ${expandedId === a.id ? 'expanded' : ''}`}
                onClick={() => toggleExpanded(a.id)}>
                <span className="swiss-ts">{formatTs(a.timestamp)}</span>
                <span className="swiss-name">{a.alertName}</span>
                <span className={`swiss-severity ${a.severity}`}>{a.severity}</span>
                <span>{a.namespace}</span>
                <span className="swiss-ts">{a.node}</span>
                <span className={`swiss-badge ${a.outcome}`}>{a.outcome.replace('-', ' ')}</span>
              </div>
              {expandedId === a.id && (
                <div className="swiss-detail">
                  <div className="swiss-detail-section">
                    <div className="swiss-detail-label">Summary</div>
                    <div className="swiss-detail-text">{a.summary}</div>
                  </div>
                  <div className="swiss-detail-section">
                    <div className="swiss-detail-label">Root Cause</div>
                    <div className="swiss-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="swiss-detail-section">
                    <div className="swiss-detail-label">Action Taken</div>
                    <div className="swiss-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="swiss-sidebar">
          <div className="swiss-sidebar-title">Cluster Health</div>

          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="swiss-node">
              <div className="swiss-node-name">
                <span>{n.name}</span>
                <span className={`swiss-node-status ${n.status === 'Ready' ? 'ready' : 'notready'}`}>
                  {n.status}
                </span>
              </div>
              <div className="swiss-bar-track">
                <div className={`swiss-bar-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
              </div>
              <div className="swiss-bar-label"><span>CPU</span><span>{n.cpu}%</span></div>
              <div className="swiss-bar-track">
                <div className={`swiss-bar-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
              </div>
              <div className="swiss-bar-label"><span>MEM</span><span>{n.memory}%</span></div>
            </div>
          ))}

          <div className="swiss-ceph">
            <div className="swiss-sidebar-title">Ceph Storage</div>
            <div className={`swiss-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="swiss-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="swiss-storage-label">
              Storage: {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="swiss-bar-track">
              <div className={`swiss-bar-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="swiss-count-row">
            <div className="swiss-count-item">
              <div className="swiss-count-num">{alerts.length}</div>
              <div className="swiss-count-label">Total</div>
            </div>
            <div className="swiss-count-item">
              <div className="swiss-count-num" style={{ color: 'var(--s1-red)' }}>
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="swiss-count-label">Critical</div>
            </div>
            <div className="swiss-count-item">
              <div className="swiss-count-num" style={{ color: 'var(--s1-escalated)' }}>
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="swiss-count-label">Escalated</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
