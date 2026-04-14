export type {
  HealthNode as NodeHealth,
  HealthResponse as ClusterHealth,
} from "@maudecode/cowtail-protocol";

export type Severity = "critical" | "warning" | "info";
export type Outcome = "fixed" | "self-resolved" | "noise" | "escalated";

export interface Alert {
  id: string;
  timestamp: string;
  alertName: string;
  severity: Severity;
  namespace: string;
  node: string;
  status: string;
  outcome: Outcome;
  summary: string;
  rootCause: string;
  actionTaken: string;
  messaged: boolean;
  resolvedAt?: string;
}

export type FixScope = "reactive" | "weekly" | "monthly";

export interface Fix {
  id: string;
  timestamp: string;
  alertIds: string[];
  description: string;
  rootCause: string;
  commit?: string;
  scope: FixScope;
}
