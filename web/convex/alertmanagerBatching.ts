export type AlertmanagerInvestigationCandidate = {
  status: string;
  severity: string;
};

function severityRank(severity: string): number {
  switch (severity.toLowerCase()) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
}

/**
 * Selects one representative firing alert for an Alertmanager notification.
 * Alertmanager already groups related alerts into one webhook payload, so one
 * durable investigation should own the whole batch instead of scheduling one
 * Hermes session per fingerprint.
 */
export function selectInvestigationCandidateIndex(
  candidates: AlertmanagerInvestigationCandidate[],
): number | undefined {
  let selectedIndex: number | undefined;
  let selectedRank = -1;

  candidates.forEach((candidate, index) => {
    if (candidate.status !== "firing") return;

    const rank = severityRank(candidate.severity);
    if (rank > selectedRank) {
      selectedIndex = index;
      selectedRank = rank;
    }
  });

  return selectedIndex;
}

export function planAlertmanagerInvestigation(candidates: AlertmanagerInvestigationCandidate[]): {
  candidateIndex: number | undefined;
  firingIndexes: number[];
} {
  return {
    candidateIndex: selectInvestigationCandidateIndex(candidates),
    firingIndexes: candidates.flatMap((candidate, index) =>
      candidate.status === "firing" ? [index] : [],
    ),
  };
}
