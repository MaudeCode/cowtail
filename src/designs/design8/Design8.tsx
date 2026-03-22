import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design8.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design8() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="s8-root">
      <header className="s8-header">
        <h1>K8S<span>ALERTS</span></h1>
        <Link to="/" className="s8-back">← INDEX</Link>
      </header>

      <div className="s8-controls">
        <div className="s8-date-section">
          <span className="s8-date-label">FROM</span>
          <input type="date" className="s8-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="s8-date-label">TO</span>
          <input type="date" className="s8-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="s8-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`s8-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'ALL' : o.replace('-', ' ').toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="s8-main">
        <div className="s8-alert-list">
          <div className="s8-alert-header-row">
            <span>TIME</span>
            <span>ALERT</span>
            <span>SEV</span>
            <span>NS</span>
            <span>NODE</span>
            <span>OUTCOME</span>
          </div>
          {alerts.map(a => (
            <div key={a.id}>
              <div className={`s8-alert-row ${expandedId === a.id ? 'expanded' : ''}`}
                onClick={() => toggleExpanded(a.id)}>
                <span className="s8-ts">{formatTs(a.timestamp)}</span>
                <span className="s8-name">{a.alertName}</span>
                <span className={`s8-severity ${a.severity}`}>{a.severity.toUpperCase()}</span>
                <span>{a.namespace}</span>
                <span className="s8-ts">{a.node}</span>
                <span className={`s8-badge ${a.outcome}`}>{a.outcome.replace('-', ' ').toUpperCase()}</span>
              </div>
              {expandedId === a.id && (
                <div className="s8-detail">
                  <div className="s8-detail-section">
                    <div className="s8-detail-label">SUMMARY</div>
                    <div className="s8-detail-text">{a.summary}</div>
                  </div>
                  <div className="s8-detail-section">
                    <div className="s8-detail-label">ROOT CAUSE</div>
                    <div className="s8-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="s8-detail-section">
                    <div className="s8-detail-label">ACTION</div>
                    <div className="s8-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="s8-sidebar">
          <div className="s8-sidebar-title">CLUSTER HEALTH</div>

          {clusterHealth.nodes.map(n => (
            <div key={n.name} className="s8-node">
              <div className="s8-node-name">
                <span>{n.name}</span>
                <span className={`s8-node-status ${n.status === 'Ready' ? 'ready' : 'notready'}`}>
                  {n.status.toUpperCase()}
                </span>
              </div>
              <div className="s8-bar-track">
                <div className={`s8-bar-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
              </div>
              <div className="s8-bar-label"><span>CPU</span><span>{n.cpu}%</span></div>
              <div className="s8-bar-track">
                <div className={`s8-bar-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
              </div>
              <div className="s8-bar-label"><span>MEM</span><span>{n.memory}%</span></div>
            </div>
          ))}

          <div className="s8-ceph">
            <div className="s8-sidebar-title">CEPH STORAGE</div>
            <div className={`s8-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="s8-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="s8-storage-label">
              {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="s8-bar-track">
              <div className={`s8-bar-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="s8-count-row">
            <div className="s8-count-item">
              <div className="s8-count-num">{alerts.length}</div>
              <div className="s8-count-label">TOTAL</div>
            </div>
            <div className="s8-count-item">
              <div className="s8-count-num s8-accent-num">
                {alerts.filter(a => a.severity === 'critical').length}
              </div>
              <div className="s8-count-label">CRITICAL</div>
            </div>
            <div className="s8-count-item">
              <div className="s8-count-num">
                {alerts.filter(a => a.outcome === 'escalated').length}
              </div>
              <div className="s8-count-label">ESCALATED</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
