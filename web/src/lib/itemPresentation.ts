import type {
  AlertPipelineState,
  ItemEventRecord,
  ItemInvestigationStep,
  ItemOutcome,
  ItemRecord,
  ItemState,
  ItemUrgency,
} from "@maudecode/cowtail-protocol";

// The one table of item wording and tones on the web. The server decides every value; these
// only name and colour them.

export type Tone = "now" | "today" | "ok" | "info" | "muted";

export const toneText: Record<Tone, string> = {
  now: "text-accent-text",
  today: "text-warn",
  ok: "text-ok",
  info: "text-info",
  muted: "text-gray-600",
};

// A status dot or a bar in the tone's colour.
export const toneFill: Record<Tone, string> = {
  now: "bg-accent",
  today: "bg-warn",
  ok: "bg-ok",
  info: "bg-info",
  muted: "bg-gray-400",
};

export const urgencyTone: Record<ItemUrgency, Tone> = {
  now: "now",
  today: "today",
  whenever: "muted",
};

export const stateTone: Record<ItemState, Tone> = {
  open: "muted",
  acked: "info",
  snoozed: "muted",
  resolved: "ok",
  expired: "muted",
};

export const outcomeTone: Record<ItemOutcome, Tone> = {
  fixed: "ok",
  "self-resolved": "info",
  noise: "muted",
  escalated: "today",
  other: "muted",
};

// The outcome bar's colours, in the mockup's order.
export const outcomeColor: Record<ItemOutcome, string> = {
  fixed: "var(--color-ok)",
  "self-resolved": "var(--color-info)",
  noise: "var(--color-gray-400)",
  escalated: "var(--color-warn)",
  other: "var(--color-gray-200)",
};

export const investigationLabel: Record<ItemInvestigationStep, string> = {
  queued: "investigation queued",
  investigating: "investigating",
  failed: "investigation failed",
};

export const pipelineLabel: Record<AlertPipelineState, string> = {
  ok: "pipeline ok",
  silent: "pipeline silent",
  not_configured: "pipeline not set up",
};

export const pipelineTone: Record<AlertPipelineState, Tone> = {
  ok: "ok",
  silent: "now",
  not_configured: "muted",
};

// How a closed item ended: its outcome, or its state when it has none.
export function itemResult(item: ItemRecord): { label: string; tone: Tone } {
  return item.outcome
    ? { label: item.outcome, tone: outcomeTone[item.outcome] }
    : { label: item.state, tone: stateTone[item.state] };
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

// What happened, in the owner's words, from the event's payload.
export function eventText({ type, actor, payload }: ItemEventRecord): string {
  switch (type) {
    case "created":
      return text(payload.state) ? `Created, ${text(payload.state)}` : "Created";
    case "repeated":
      return text(payload.occurrenceCount)
        ? `Happened again, ×${text(payload.occurrenceCount)}`
        : "Happened again";
    case "dispatched":
      return "Investigation sent to Hermes";
    case "hermes_update":
      return text(payload.text) ?? "";
    case "notified":
      return text(payload.reason) ?? text(payload.result) ?? "Push sent";
    case "action_taken": {
      const detail = text(payload.option) ?? text(payload.text);
      const action = `${actor} · ${text(payload.type) ?? "action"}`;
      return detail ? `${action}: ${detail}` : action;
    }
    case "state_changed":
    case "resolved":
      return [
        [text(payload.from), text(payload.to)].filter(Boolean).join(" → "),
        text(payload.reason),
      ]
        .filter(Boolean)
        .join(" · ");
  }
}

export const eventTone: Record<ItemEventRecord["type"], Tone> = {
  created: "now",
  repeated: "now",
  dispatched: "info",
  hermes_update: "info",
  notified: "muted",
  action_taken: "today",
  state_changed: "muted",
  resolved: "ok",
};
