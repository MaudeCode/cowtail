interface ProgressBarProps {
  label: string;
  // 0 to 100.
  value: number;
  // What the right column shows; the percentage by default.
  display?: string;
  highThreshold?: number;
  wide?: boolean;
}

export default function ProgressBar({
  label,
  value,
  display = `${value}%`,
  highThreshold = 80,
  wide = false,
}: ProgressBarProps) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div
      className={`grid items-center gap-2 font-mono text-[0.65rem] text-gray-600 ${wide ? "grid-cols-[52px_1fr_auto] py-1.5" : "mt-1 grid-cols-[30px_1fr_34px]"}`}
    >
      <span>{label}</span>
      <div className="h-1 bg-line">
        <div
          className={`h-full transition-[width] duration-500 ease-out ${value > highThreshold ? "bg-accent" : "bg-gray-400"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-right">{display}</span>
    </div>
  );
}
