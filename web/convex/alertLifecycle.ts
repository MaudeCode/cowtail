export type AlertDisposition = {
  outcome: string;
  action: string;
};

export type AlertLifecycleState = {
  status: string;
  outcome: string;
};

export type AlertLifecycleUpdate = {
  status: string;
  endsAt?: number;
};

const nonTerminalOutcomes = new Set(["pending", "recorded"]);

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function stableLabelsFingerprint(labels: Record<string, unknown>): string {
  const entries = Object.entries(labels)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return `labels:${JSON.stringify(entries)}`;
}

export function alertmanagerFingerprint(
  fingerprint: unknown,
  labels: Record<string, unknown>,
): string {
  return nonEmptyString(fingerprint) ?? stableLabelsFingerprint(labels);
}

export function alertLifecycleDedupeKey(fingerprint: string, startsAt?: number): string {
  return JSON.stringify([fingerprint, startsAt ?? null]);
}

export function resolveAlertLifecyclePatch(
  existing: AlertLifecycleState,
  incoming: AlertLifecycleUpdate,
  disposition: AlertDisposition,
): Record<string, string | number | undefined> {
  if (existing.status === "resolved" && incoming.status !== "resolved") {
    return {};
  }

  if (incoming.status !== "resolved") {
    return { status: incoming.status };
  }

  return {
    status: "resolved",
    endsAt: incoming.endsAt,
    resolvedAt: incoming.endsAt,
    ...(nonTerminalOutcomes.has(existing.outcome) ? disposition : {}),
  };
}

export function preservesInvestigationOutcome(outcome: string): boolean {
  return !nonTerminalOutcomes.has(outcome);
}
