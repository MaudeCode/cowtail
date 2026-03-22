import { Link } from 'react-router-dom';
import { useAlertFilter } from '../../hooks/useAlertFilter';
import { clusterHealth } from '../../data/mockAlerts';
import type { Outcome } from '../../types';
import './design4.css';

const outcomes: Array<Outcome | 'all'> = ['all', 'fixed', 'self-resolved', 'noise', 'escalated'];

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Design4() {
  const { alerts, outcomeFilter, setOutcomeFilter, dateRange, setDateRange, expandedId, toggleExpanded } = useAlertFilter();

  return (
    <div className="frost-root">
      <header className="frost-header">
        <h1 className="frost-title"><span>K8s</span> Alerts</h1>
        <Link to="/" className="frost-back">← Back</Link>
      </header>

      <div className="frost-controls">
        <div className="frost-date-section">
          <span className="frost-date-label">From</span>
          <input type="date" className="frost-date-input" value={dateRange.start}
            onChange={e => setDateRange({ ...dateRange, start: e.target.value })} />
          <span className="frost-date-label">To</span>
          <input type="date" className="frost-date-input" value={dateRange.end}
            onChange={e => setDateRange({ ...dateRange, end: e.target.value })} />
        </div>
        <div className="frost-filter-section">
          {outcomes.map(o => (
            <button key={o}
              className={`frost-filter-btn ${outcomeFilter === o ? 'active' : ''}`}
              onClick={() => setOutcomeFilter(o)}>
              {o === 'all' ? 'All' : o.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="frost-layout">
        <div className="frost-alert-list">
          {alerts.map(a => (
            <div key={a.id} className={`frost-alert-card ${expandedId === a.id ? 'expanded' : ''}`}
              onClick={() => toggleExpanded(a.id)}>
              <div className="frost-alert-row">
                <span className="frost-ts">{formatTs(a.timestamp)}</span>
                <span className="frost-alert-name">{a.alertName}</span>
                <span className={`frost-sev ${a.severity}`}>{a.severity}</span>
                <span>{a.namespace}</span>
                <span className="frost-ts">{a.node}</span>
                <span className={`frost-badge ${a.outcome}`}>{a.outcome.replace('-', ' ')}</span>
              </div>
              {expandedId === a.id && (
                <div className="frost-detail">
                  <div className="frost-detail-block">
                    <div className="frost-detail-label">Summary</div>
                    <div className="frost-detail-text">{a.summary}</div>
                  </div>
                  <div className="frost-detail-block">
                    <div className="frost-detail-label">Root Cause</div>
                    <div className="frost-detail-text">{a.rootCause}</div>
                  </div>
                  <div className="frost-detail-block">
                    <div className="frost-detail-label">Action Taken</div>
                    <div className="frost-detail-text">{a.actionTaken}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="frost-sidebar">
          <div className="frost-panel">
            <div className="frost-panel-title">Nodes</div>
            {clusterHealth.nodes.map(n => (
              <div key={n.name}>
                <div className="frost-node-item">
                  <span className="frost-node-name">{n.name}</span>
                  <span className={n.status === 'Ready' ? 'frost-node-ready' : 'frost-node-notready'}>
                    {n.status}
                  </span>
                </div>
                <div className="frost-meter-group">
                  <div className="frost-meter-row">
                    <span className="frost-meter-label">CPU</span>
                    <div className="frost-meter-track">
                      <div className={`frost-meter-fill ${n.cpu > 80 ? 'high' : ''}`} style={{ width: `${n.cpu}%` }} />
                    </div>
                    <span className="frost-meter-val">{n.cpu}%</span>
                  </div>
                  <div className="frost-meter-row">
                    <span className="frost-meter-label">MEM</span>
                    <div className="frost-meter-track">
                      <div className={`frost-meter-fill ${n.memory > 80 ? 'high' : ''}`} style={{ width: `${n.memory}%` }} />
                    </div>
                    <span className="frost-meter-val">{n.memory}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="frost-panel">
            <div className="frost-panel-title">Ceph Storage</div>
            <div className={`frost-ceph-status ${clusterHealth.cephStatus === 'HEALTH_OK' ? 'ok' : clusterHealth.cephStatus === 'HEALTH_WARN' ? 'warn' : 'err'}`}>
              {clusterHealth.cephStatus.replace('HEALTH_', '')}
            </div>
            <div className="frost-ceph-msg">{clusterHealth.cephMessage}</div>
            <div className="frost-storage-label">
              {clusterHealth.storageUsed} / {clusterHealth.storageTotal} {clusterHealth.storageUnit}
            </div>
            <div className="frost-meter-track">
              <div className={`frost-meter-fill ${(clusterHealth.storageUsed / clusterHealth.storageTotal) > 0.8 ? 'high' : ''}`}
                style={{ width: `${(clusterHealth.storageUsed / clusterHealth.storageTotal) * 100}%` }} />
            </div>
          </div>

          <div className="frost-panel">
            <div className="frost-panel-title">Summary</div>
            <div className="frost-stats-grid">
              <div className="frost-stat-card">
                <div className="frost-stat-num">{alerts.length}</div>
                <div className="frost-stat-label">Total</div>
              </div>
              <div className="frost-stat-card">
                <div className="frost-stat-num" style={{ color: '#c43030' }}>
                  {alerts.filter(a => a.severity === 'critical').length}
                </div>
                <div className="frost-stat-label">Critical</div>
              </div>
              <div className="frost-stat-card">
                <div className="frost-stat-num" style={{ color: 'var(--frost-escalated)' }}>
                  {alerts.filter(a => a.outcome === 'escalated').length}
                </div>
                <div className="frost-stat-label">Escalated</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
