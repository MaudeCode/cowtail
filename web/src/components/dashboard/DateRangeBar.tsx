type DatePreset = "24h" | "7d" | "30d" | "custom";

const presets: Array<{ key: DatePreset; label: string }> = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

interface DateRangeBarProps {
  datePreset: DatePreset;
  dateRange: { start: string; end: string };
  onPreset: (preset: DatePreset) => void;
  onDateChange: (field: "start" | "end", value: string) => void;
}

export default function DateRangeBar({
  datePreset,
  dateRange,
  onPreset,
  onDateChange,
}: DateRangeBarProps) {
  return (
    <div className="flex items-center gap-3 px-10 py-5 border-b border-gray-200 bg-surface flex-wrap max-lg:px-3 max-lg:py-2 max-lg:gap-2">
      {presets.map((p) => (
        <button
          key={p.key}
          className={`font-mono text-[0.65rem] uppercase tracking-[0.08em] px-3.5 py-1.5 border cursor-pointer transition-all duration-[120ms] max-lg:px-2.5 max-lg:py-1 max-lg:text-[0.6rem] ${
            datePreset === p.key
              ? "bg-accent text-white border-accent"
              : "border-gray-200 bg-transparent text-gray-400 hover:bg-gray-100 hover:text-txt"
          }`}
          onClick={() => onPreset(p.key)}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-2 max-lg:w-full max-lg:mt-1">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400 max-lg:text-[0.55rem]">
          From
        </span>
        <input
          type="date"
          className="font-mono text-[0.85rem] border border-gray-200 px-2.5 py-1.5 bg-bg text-txt focus:outline-2 focus:outline-accent focus:outline-offset-1 max-lg:text-[0.75rem] max-lg:px-1.5 max-lg:py-1 max-lg:flex-1"
          value={dateRange.start}
          onChange={(e) => onDateChange("start", e.target.value)}
        />
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400 max-lg:text-[0.55rem]">
          To
        </span>
        <input
          type="date"
          className="font-mono text-[0.85rem] border border-gray-200 px-2.5 py-1.5 bg-bg text-txt focus:outline-2 focus:outline-accent focus:outline-offset-1 max-lg:text-[0.75rem] max-lg:px-1.5 max-lg:py-1 max-lg:flex-1"
          value={dateRange.end}
          onChange={(e) => onDateChange("end", e.target.value)}
        />
      </div>
    </div>
  );
}
