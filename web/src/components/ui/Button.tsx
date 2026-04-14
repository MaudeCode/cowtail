interface ButtonProps {
  active?: boolean;
  variant?: "filter" | "preset";
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Button({
  active,
  variant = "filter",
  onClick,
  children,
  className = "",
}: ButtonProps) {
  const base = "cursor-pointer transition-all duration-100 border";

  const variants = {
    filter: {
      idle: "font-sans text-xs font-medium uppercase tracking-wide px-4 py-1.5 border-gray-200 bg-transparent text-gray-600 hover:bg-gray-100 hover:text-txt",
      active:
        "font-sans text-xs font-medium uppercase tracking-wide px-4 py-1.5 border-txt bg-txt text-bg",
    },
    preset: {
      idle: "font-mono text-[0.65rem] uppercase tracking-wide px-3 py-1 border-gray-200 bg-transparent text-gray-400 hover:bg-gray-100 hover:text-txt",
      active:
        "font-mono text-[0.65rem] uppercase tracking-wide px-3 py-1 border-accent bg-accent text-white",
    },
  };

  const style = active ? variants[variant].active : variants[variant].idle;

  return (
    <button className={`${base} ${style} ${className}`} onClick={onClick}>
      {children}
    </button>
  );
}
