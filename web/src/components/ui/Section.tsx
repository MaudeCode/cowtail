import type { ReactNode } from "react";

import { errorMessage } from "../../lib/api";

// A section is a small uppercase mono label over rows or a table split by hairlines.
export function SectionLabel({ label, detail }: { label: ReactNode; detail?: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 border-b border-gray-200 pt-3.5 pb-1.5 font-mono text-[0.65rem] font-normal uppercase tracking-[0.13em] text-gray-600">
      <span>{label}</span>
      {detail !== undefined && <span className="ml-auto flex items-center gap-2">{detail}</span>}
    </h2>
  );
}

export default function Section({
  label,
  detail,
  children,
}: {
  label: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section>
      <SectionLabel label={label} detail={detail} />
      {children}
    </section>
  );
}

// One label and value, split from the next by a hairline.
export function KeyValue({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b border-line py-1.5">
      <div className="min-w-0">{label}</div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-right text-gray-600">
        {children}
      </div>
    </div>
  );
}

// Command output: a monospace block that wraps instead of scrolling sideways.
export const outputBlock =
  "border-l-2 border-gray-200 bg-surface px-2 py-1.5 font-mono text-[0.68rem] leading-[1.45] whitespace-pre-wrap text-[#c9c9cf] [overflow-wrap:anywhere]";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-b border-line py-2 text-[0.8rem] text-gray-600">{children}</p>;
}

// A refused or failed action, under the control that sent it.
export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[0.7rem] text-accent-text">
      {errorMessage(error)}
    </p>
  );
}

export function QueryError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="py-2 text-[0.8rem] text-accent-text">
      {errorMessage(error)}
    </p>
  );
}
