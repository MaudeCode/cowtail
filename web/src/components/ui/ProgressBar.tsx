interface ProgressBarProps {
  value: number;
  label?: string;
  showLabel?: boolean;
  highThreshold?: number;
}

export default function ProgressBar({
  value,
  label,
  showLabel = true,
  highThreshold = 80,
}: ProgressBarProps) {
  const isHigh = value > highThreshold;
  return (
    <div>
      <div className="h-1 bg-gray-100 mt-1.5">
        <div
          className={`h-full transition-all duration-500 ease-out ${isHigh ? "bg-accent shadow-[0_0_8px_var(--color-accent-dim)]" : "bg-gray-400"}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {showLabel && label && (
        <div className="font-mono text-[0.6rem] text-gray-400 mt-1 flex justify-between">
          <span>{label}</span>
          <span>{value}%</span>
        </div>
      )}
    </div>
  );
}
