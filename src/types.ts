export type Severity = 'critical' | 'warning' | 'info';
export type Outcome = 'fixed' | 'self-resolved' | 'noise' | 'escalated';

export interface Alert {
  id: string;
  timestamp: string;
  alertName: string;
  severity: Severity;
  namespace: string;
  node: string;
  outcome: Outcome;
  summary: string;
  rootCause: string;
  actionTaken: string;
}

export interface NodeHealth {
  name: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  cpu: number;
  memory: number;
}

export type FixScope = 'reactive' | 'weekly' | 'monthly';

export interface Fix {
  id: string;
  timestamp: string;
  alertIds: string[];
  description: string;
  rootCause: string;
  commit?: string;
  scope: FixScope;
}

export interface ClusterHealth {
  nodes: NodeHealth[];
  cephStatus: 'HEALTH_OK' | 'HEALTH_WARN' | 'HEALTH_ERR';
  cephMessage: string;
  storageTotal: number;
  storageUsed: number;
  storageUnit: string;
}
