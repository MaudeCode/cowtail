const severityStyles: Record<string, string> = {
  critical: "text-accent font-bold severity-glow-critical",
  warning: "text-escalated",
  info: "text-gray-400",
};

interface SeverityLabelProps {
  // Alertmanager's severity label; any other value shows muted.
  severity: string;
  className?: string;
}

export default function SeverityLabel({ severity, className = "" }: SeverityLabelProps) {
  return (
    <span
      className={`font-mono text-[0.7rem] uppercase ${severityStyles[severity] ?? "text-gray-400"} ${className}`}
    >
      {severity}
    </span>
  );
}
