import type { ItemKind, ItemState, ItemUrgency } from "@maudecode/cowtail-protocol";

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

// An item linked to an alert follows the alert's workflow; every other item follows its
// kind and urgency.
export function itemNeedsOwner(
  item: { state: ItemState; kind: ItemKind; urgency: ItemUrgency },
  alertWorkflow?: AlertWorkflowState,
): boolean {
  if (item.state !== "open") return false;
  if (alertWorkflow) {
    return alertWorkflow === "needsReview" || alertWorkflow === "investigationFailed";
  }
  return item.kind === "approval" || item.kind === "question" || item.urgency === "now";
}
