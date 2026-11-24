import {
  itemOutcomes,
  type ItemInvestigationStep,
  type ItemKind,
  type ItemOutcome,
  type ItemState,
  type ItemUrgency,
} from "@maudecode/cowtail-protocol";

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

const answerTypes = new Set(["approve", "deny", "choose", "reply"]);

// What the owner can still do with an item: a closed item keeps only its links, and an
// answered item takes no second answer.
export function itemAvailableActions<Action extends { type: string }>(item: {
  state: ItemState;
  actions: Action[];
  answeredAt?: number;
}): Action[] {
  if (terminalItemStates.has(item.state)) {
    return item.actions.filter((action) => action.type === "open");
  }
  if (item.answeredAt !== undefined) {
    return item.actions.filter((action) => !answerTypes.has(action.type));
  }
  return item.actions;
}

// An item linked to an alert follows the alert's workflow; every other item follows its
// kind and urgency until the owner answers it.
export function itemNeedsOwner(
  item: { state: ItemState; kind: ItemKind; urgency: ItemUrgency; answeredAt?: number },
  alertWorkflow?: AlertWorkflowState,
): boolean {
  if (item.state !== "open") return false;
  if (item.answeredAt !== undefined) return false;
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

// An alert item's second line: where it fired.
export function itemSubtitle(item: { context: Record<string, string>; kind: ItemKind }) {
  if (item.kind !== "alert") return undefined;
  const parts = [item.context.namespace, item.context.node].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
