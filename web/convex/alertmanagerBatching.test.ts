import { describe, expect, test } from "bun:test";

import { selectInvestigationCandidateIndex } from "./alertmanagerBatching";

describe("Alertmanager investigation batching", () => {
  test("selects one representative from a batch of firing alerts", () => {
    expect(
      selectInvestigationCandidateIndex([
        { status: "firing", severity: "warning" },
        { status: "firing", severity: "warning" },
        { status: "firing", severity: "warning" },
      ]),
    ).toBe(0);
  });

  test("prefers a critical alert even when it arrives later in the batch", () => {
    expect(
      selectInvestigationCandidateIndex([
        { status: "firing", severity: "warning" },
        { status: "resolved", severity: "critical" },
        { status: "firing", severity: "critical" },
      ]),
    ).toBe(2);
  });

  test("keeps a 60-alert storm to one critical representative", () => {
    const alerts = Array.from({ length: 60 }, () => ({
      status: "firing",
      severity: "warning",
    }));
    alerts[47] = { status: "firing", severity: "critical" };

    expect(selectInvestigationCandidateIndex(alerts)).toBe(47);
  });

  test("does not schedule an investigation for a resolved-only batch", () => {
    expect(
      selectInvestigationCandidateIndex([
        { status: "resolved", severity: "critical" },
        { status: "resolved", severity: "warning" },
      ]),
    ).toBeUndefined();
  });
});
