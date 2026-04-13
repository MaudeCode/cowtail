import type { Severity } from '../../types';

const severityStyles: Record<Severity, string> = {
  critical: 'text-accent font-bold severity-glow-critical',
  warning: 'text-escalated',
  info: 'text-gray-400',
};

interface SeverityLabelProps {
  severity: Severity;
  className?: string;
}

export default function SeverityLabel({ severity, className = '' }: SeverityLabelProps) {
  return (
    <span className={`font-mono text-[0.7rem] uppercase ${severityStyles[severity]} ${className}`}>
      {severity}
    </span>
  );
}
