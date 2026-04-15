import { Button } from "../ui";
import type { Outcome } from "../../types";

const outcomes: Array<Outcome | "all"> = ["all", "fixed", "self-resolved", "noise", "escalated"];

function label(o: string) {
  if (o === "all") return "All";
  if (o === "self-resolved") return "Self Resolved";
  return o;
}

interface OutcomeFilterProps {
  value: Outcome | "all";
  onChange: (v: Outcome | "all") => void;
}

export default function OutcomeFilter({ value, onChange }: OutcomeFilterProps) {
  return (
    <div className="px-6 sm:px-10 py-4 flex items-center gap-2 flex-wrap">
      {outcomes.map((o) => (
        <Button key={o} variant="filter" active={value === o} onClick={() => onChange(o)}>
          {label(o)}
        </Button>
      ))}
    </div>
  );
}
