import type { Alert, Outcome } from '../types';

export interface ConvexAlert {
  _id: string;
  _creationTime: number;
  timestamp: number;
  alertname: string;
  severity: string;
  namespace: string;
  node?: string;
  status: string;
  outcome: string;
  summary: string;
  action: string;
  rootCause?: string;
  messaged: boolean;
  resolvedAt?: number;
}

export function toAlert(alert: ConvexAlert): Alert {
  return {
    id: alert._id,
    timestamp: new Date(alert.timestamp).toISOString(),
    alertName: alert.alertname,
    severity: alert.severity as 'critical' | 'warning' | 'info',
    namespace: alert.namespace,
    node: alert.node ?? '',
    status: alert.status,
    outcome: alert.outcome as Outcome,
    summary: alert.summary,
    rootCause: alert.rootCause ?? '',
    actionTaken: alert.action,
    messaged: alert.messaged,
    resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt).toISOString() : undefined,
  };
}

export function alertPath(alertId: string): string {
  return `/alerts/${encodeURIComponent(alertId)}`;
}
