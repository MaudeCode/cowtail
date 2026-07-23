import { describe, expect, test } from "bun:test";

import { shouldCreateInvestigationJobForReceiver } from "./http";

describe("Alertmanager webhook receiver policy", () => {
  test("keeps cowtail-direct ledger-only", () => {
    expect(shouldCreateInvestigationJobForReceiver("cowtail-direct")).toBe(false);
    expect(
      shouldCreateInvestigationJobForReceiver("observability/alertmanager/cowtail-direct"),
    ).toBe(false);
  });

  test("creates investigation jobs only for the explicit investigate receiver", () => {
    expect(shouldCreateInvestigationJobForReceiver("cowtail-investigate")).toBe(true);
    expect(
      shouldCreateInvestigationJobForReceiver("observability/alertmanager/cowtail-investigate"),
    ).toBe(true);
    expect(shouldCreateInvestigationJobForReceiver(" openclaw ")).toBe(false);
    expect(shouldCreateInvestigationJobForReceiver(undefined)).toBe(false);
  });
});
