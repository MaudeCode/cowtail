// An on/off setting.
export default function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${checked ? "bg-ok" : "bg-gray-200"}`}
    >
      <span
        className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-[left] ${checked ? "left-3.5" : "left-0.5"}`}
      />
    </button>
  );
}
