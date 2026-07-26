export type InitialAlertDisposition = {
  outcome: "pending" | "recorded" | "self-resolved";
  action: string;
};

export function resolveInitialAlertDisposition(
  status: string,
  investigationPending: boolean,
): InitialAlertDisposition {
  if (status === "resolved") {
    return {
      outcome: "self-resolved",
      action: "Alertmanager reported this alert resolved.",
    };
  }

  if (investigationPending) {
    return {
      outcome: "pending",
      action: "Recorded by Cowtail Alertmanager ingest. Investigation pending.",
    };
  }

  return {
    outcome: "recorded",
    action: "Recorded by Cowtail Alertmanager ingest. No immediate investigation requested.",
  };
}
