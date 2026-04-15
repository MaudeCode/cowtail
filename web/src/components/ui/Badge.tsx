import type { Outcome } from "../../types";

const outcomeStyles: Record<Outcome, string> = {
  fixed: "bg-fixed",
  "self-resolved": "bg-self-resolved",
  noise: "bg-noise",
  escalated: "bg-escalated",
};

interface BadgeProps {
  outcome: Outcome;
  className?: string;
}

export default function Badge({ outcome, className = "" }: BadgeProps) {
  const label = outcome === "self-resolved" ? "self resolved" : outcome;
  return (
    <span
      className={`inline-block font-mono text-[0.65rem] uppercase tracking-[0.08em] px-2 py-[3px] font-medium text-white ${outcomeStyles[outcome]} ${className}`}
    >
      {label}
    </span>
  );
}
