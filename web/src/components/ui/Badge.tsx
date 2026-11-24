import type { ReactNode } from "react";

import { toneFill, toneText, type Tone } from "../../lib/itemPresentation";

const toneBorder: Record<Tone, string> = {
  now: "border-[#b8242c99]",
  today: "border-[#d4880a80]",
  ok: "border-[#2d9b5280]",
  info: "border-gray-200",
  muted: "border-gray-200",
};

// A small pill: an outcome, a state, a count or a filter.
export default function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 font-mono text-[0.65rem] leading-4 ${toneText[tone]} ${toneBorder[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// A small round light in the tone's colour: the cluster's or Hermes's state.
export function StatusDot({ tone }: { tone: Tone }) {
  return <i className={`inline-block size-[7px] shrink-0 rounded-full ${toneFill[tone]}`} />;
}
