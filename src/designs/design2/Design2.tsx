import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design2.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design2() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="cp-root">
      <div className="cp-matrix-bg" />

      <header className="cp-header">
        <h1 className="cp-title">
          <span className="cp-title-glitch" data-text="K8S_ALERTS">K8S_ALERTS</span>
        </h1>
        <Link to="/" className="cp-back">[ EXIT ]</Link>
      </header>

      <div className="cp-controls">
        <div className="cp-date-section">
          <span className="cp-date-label">START://</span>
          <input type="date" className="cp-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="cp-date-label">END://</span>
          <input type="date" className="cp-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="cp-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`cp-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              [{o === 'all' ? '*' : o.replace('-', '_')}]
            </button>
          ))}
        </div>
      </div>

      <div className="cp-layout">
        <div className="cp-alert-list">
          <div className="cp-alert-header-row">
            <span>TIMESTAMP</span>
            <span>ALERT_ID</span>
            <span>SEV</span>
            <span>NS</span>
            <span>NODE</span>
            <span>STATUS</span>
          </div>
          {alerts.map(a => (
            <div key={a.id} className={`cp-alert-item ${expandedId === a.id ? 'expanded' : ''}`}
              onClick={() => toggleExpanded(a.id)}>
              <div className="cp-alert-row">
                <span className="cp-ts">{formatTs(a.timestamp)}</span>
                <span className="cp-alert-name">{a.alertName}</span>
                <span className={`cp-sev ${a.severity}`}>{a.severity}</span>
                <span>{a.namespace}</span>
                <span className="cp-ts">{a.node}</span>
                <span className={`cp-badge ${a.outcome}`}>{a.outcome.replace('-', '_')}</span>
              </div>
              {expandedId === a.id && (
                <div className="cp-detail">
                  <div className="cp-detail-block">
                    <div className="cp-detail-label">&gt; SUMMARY</div>
                    <div className="cp-detail-text">{a.summary}</div>
                  </div>
                  <div className="cp-detail-block">
                    <div className="cp-detail-label">&gt; ROOT_CAUSE</div>
                    <div className="cp-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="cp-detail-block">
                    <div className="cp-detail-label">&gt; ACTION_TAKEN</div>
                    <div className="cp-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="cp-sidebar">
          <div className="cp-sidebar-title">// NODE_STATUS</div>
          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="cp-node-card">
              <div className="cp-node-header">
                <span className="cp-node-name">{n.name}</span>
                <span className={n.status === 'Ready' ? 'cp-node-ready' : 'cp-node-notready'}>
                  {n.status.toUpperCase()}
                </span>
              </div>
              <div className="cp-gauge-row">
                <span className="cp-gauge-label">CPU</span>
                <div className="cp-gauge-track">
                  <div className={`cp-gauge-fill ${n.cpu > 80 ? 'hot' : ''}`} style={{ width: `${n.cpu}%` }} />
                </div>
                <span className="cp-gauge-val">{n.cpu}%</span>
              </div>
              <div className="cp-gauge-row">
                <span className="cp-gauge-label">MEM</span>
                <div className="cp-gauge-track">
                  <div className={`cp-gauge-fill ${n.memory > 80 ? 'hot' : ''}`} style={{ width: `${n.memory}%` }} />
                </div>
                <span className="cp-gauge-val">{n.memory}%</span>
              </div>
            </div>
          ))}

          <div className="cp-ceph-section">
            <div className="cp-sidebar-title">// CEPH_CLUSTER</div>
            <div className={`cp-ceph-badge ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus}
            </div>
            <div className="cp-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="cp-storage-info">
              STORAGE: {clusterHealth.storageUsed}/{clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="cp-gauge-track">
              <div className={`cp-gauge-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'hot' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="cp-stats-row">
            <div className="cp-stat-item">
              <div className="cp-stat-num">{alerts.length}</div>
              <div className="cp-stat-label">Total</div>
            </div>
            <div className="cp-stat-item">
              <div className="cp-stat-num" style={{ color: 'var(--cp-neon-pink)' }}>
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="cp-stat-label">Critical</div>
            </div>
            <div className="cp-stat-item">
              <div className="cp-stat-num" style={{ color: 'var(--cp-neon-yellow)' }}>
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="cp-stat-label">Escalated</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
