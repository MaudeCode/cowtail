import {
  itemOutcomes,
  type ItemAction,
  type ItemAvailableAction,
  type ItemInvestigationStep,
  type ItemKind,
  type ItemOutcome,
  type ItemState,
  type ItemUrgency,
  type SnoozePreset,
} from "@maudecode/cowtail-protocol";

import { addDaysToDateOnly, dateOnlyForInstant, zonedDateTimeToUtcTimestamp } from "./roundup";

// The states the apps derived on the client before items existed. The server owns them now.
export type AlertWorkflowState =
  | "investigationFailed"
  | "needsReview"
  | "investigating"
  | "queued"
  | "monitoring"
  | "active"
  | "recovered"
  | "fixed"
  | "classifiedNoise"
  | "recorded";

export type AlertWorkflowInput = {
  status: string;
  outcome: string;
  ownerDisposition?: "noise" | "escalated";
};

export function alertWorkflowState(
  alert: AlertWorkflowInput,
  investigationStatus?: string,
): AlertWorkflowState {
  if (alert.ownerDisposition === "noise" || alert.outcome === "noise") return "classifiedNoise";
  if (alert.ownerDisposition === "escalated") return "needsReview";
  if (alert.status === "resolved") {
    if (alert.outcome === "escalated") return "needsReview";
    return alert.outcome === "fixed" ? "fixed" : "recovered";
  }
  if (alert.outcome === "self-resolved") return "recovered";
  if (investigationStatus === "deadletter" || investigationStatus === "failed") {
    return "investigationFailed";
  }
  if (alert.outcome === "escalated") return "needsReview";
  if (investigationStatus === "claimed") return "investigating";
  if (investigationStatus === "queued") return "queued";
  if (alert.status === "firing") return alert.outcome === "fixed" ? "monitoring" : "active";
  return alert.outcome === "fixed" ? "fixed" : "recorded";
}

const closedWorkflowStates = new Set<AlertWorkflowState>([
  "recovered",
  "fixed",
  "classifiedNoise",
  "recorded",
]);

export function alertItemState(workflow: AlertWorkflowState): "open" | "resolved" {
  return closedWorkflowStates.has(workflow) ? "resolved" : "open";
}

export function alertItemUrgency(severity: string): ItemUrgency {
  switch (severity.toLowerCase()) {
    case "critical":
      return "now";
    case "warning":
      return "today";
    default:
      return "whenever";
  }
}

export const terminalItemStates = new Set<ItemState>(["resolved", "expired"]);

// The owner's calls on an alert: a retry once its newest investigation is no longer queued
// or running, as alerts.applyOwnerAction accepts; noise and escalation always.
export function alertOwnerActions(jobs: { status: string }[]) {
  const running = jobs.some((job) => job.status === "queued" || job.status === "claimed");
  return [
    ...(jobs.length > 0 && !running ? (["retry-investigation"] as const) : []),
    "mark-noise" as const,
    "escalate" as const,
  ];
}

const answerTypes = new Set(["approve", "deny", "choose", "reply"]);

// Approvals and questions wait on the owner's answer, so an ack would drop them unanswered;
// every other kind is acknowledged, from the push and from the item alike.
export function itemKindTakesAck(kind: ItemKind): boolean {
  return kind !== "approval" && kind !== "question";
}

// What the owner can do with an item now: what its producer declared, and Cowtail's own
// Acknowledge, Snooze and Unsnooze wherever applyAction takes them. A closed item keeps only
// its links, and an answered item takes no second answer and gets no Acknowledge or Snooze.
export function itemAvailableActions(item: {
  kind: ItemKind;
  state: ItemState;
  actions: ItemAction[];
  answeredAt?: number;
}): ItemAvailableAction[] {
  if (terminalItemStates.has(item.state)) {
    return item.actions.filter((action) => action.type === "open");
  }
  const answered = item.answeredAt !== undefined;
  const declared = answered
    ? item.actions.filter((action) => !answerTypes.has(action.type))
    : item.actions;
  if (item.state === "snoozed") return [...declared, { type: "unsnooze" }];
  if (answered) return declared;
  if (item.state === "acked") return declared.filter((action) => action.type !== "ack");
  const declares = (type: string) => declared.some((action) => action.type === type);
  return [
    ...declared,
    ...(itemKindTakesAck(item.kind) && !declares("ack") ? [{ type: "ack" } as const] : []),
    ...(declares("snooze") ? [] : [{ type: "snooze" } as const]),
  ];
}

// An open item the owner has not answered: its delivered notification stays on the device.
export function itemIsLive(item: { state: ItemState; answeredAt?: number }): boolean {
  return item.state === "open" && item.answeredAt === undefined;
}

// An item linked to an alert follows the alert's workflow; every other item follows its
// kind and urgency until the owner answers it.
export function itemNeedsOwner(
  item: { state: ItemState; kind: ItemKind; urgency: ItemUrgency; answeredAt?: number },
  alertWorkflow?: AlertWorkflowState,
): boolean {
  if (!itemIsLive(item)) return false;
  if (alertWorkflow) {
    return alertWorkflow === "needsReview" || alertWorkflow === "investigationFailed";
  }
  return item.kind === "approval" || item.kind === "question" || item.urgency === "now";
}

const investigationSteps: Partial<Record<AlertWorkflowState, ItemInvestigationStep>> = {
  queued: "queued",
  investigating: "investigating",
  investigationFailed: "failed",
};

export function itemInvestigationStep(
  workflow: AlertWorkflowState | undefined,
): ItemInvestigationStep | undefined {
  return workflow ? investigationSteps[workflow] : undefined;
}

const knownOutcomes = new Set<string>(itemOutcomes);

// An owner's noise call outranks every other outcome, as in alertWorkflowState. An item
// without an alert reports the disposition its producer set in its context.
export function itemOutcome(
  item: { context: Record<string, string> },
  alert: AlertWorkflowInput | null,
): ItemOutcome {
  const outcome = alert
    ? alert.ownerDisposition === "noise" || alert.outcome === "noise"
      ? "noise"
      : (alert.ownerDisposition ?? alert.outcome)
    : item.context.disposition;
  return outcome !== undefined && knownOutcomes.has(outcome) ? (outcome as ItemOutcome) : "other";
}

const HOUR_MS = 60 * 60 * 1000;

// The snooze picker's presets in `timeZone`: an hour and four hours from now, and 09:00
// tomorrow and on the first Monday after today.
export function snoozeOptions(
  now: number,
  timeZone: string,
): { preset: SnoozePreset; until: number }[] {
  const today = dateOnlyForInstant(new Date(now), timeZone);
  const nineAm = (daysAhead: number) => {
    const [year, month, day] = addDaysToDateOnly(today, daysAhead).split("-").map(Number);
    return zonedDateTimeToUtcTimestamp(year, month, day, 9, 0, 0, timeZone);
  };
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return [
    { preset: "1h", until: now + HOUR_MS },
    { preset: "4h", until: now + 4 * HOUR_MS },
    { preset: "tomorrow", until: nineAm(1) },
    { preset: "next_monday", until: nineAm((8 - weekday) % 7 || 7) },
  ];
}

// An alert item's second line: where it fired.
export function itemSubtitle(item: { context: Record<string, string>; kind: ItemKind }) {
  if (item.kind !== "alert") return undefined;
  const parts = [item.context.namespace, item.context.node].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
