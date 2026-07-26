import { describe, expect, test } from "bun:test";

import {
  isBearerTokenAuthorized,
  parseInvestigationOutcome,
  shouldCreateInvestigationJobForReceiver,
} from "./http";

describe("investigation outcomes", () => {
  test("accepts only protocol alert outcomes", () => {
    expect(parseInvestigationOutcome("fixed")).toBe("fixed");
    expect(parseInvestigationOutcome("self-resolved")).toBe("self-resolved");
    expect(parseInvestigationOutcome("noise")).toBe("noise");
    expect(parseInvestigationOutcome("verified_synthetic_probe")).toBeUndefined();
    expect(parseInvestigationOutcome(undefined)).toBeUndefined();
  });
});

describe("trusted Cowtail write credentials", () => {
  test("accepts either the service or worker bearer token", () => {
    expect(isBearerTokenAuthorized("Bearer service-token", ["service-token", "worker-token"])).toBe(
      true,
    );
    expect(isBearerTokenAuthorized("Bearer worker-token", ["service-token", "worker-token"])).toBe(
      true,
    );
  });

  test("rejects missing, malformed, and unrelated credentials", () => {
    expect(isBearerTokenAuthorized(undefined, ["service-token", "worker-token"])).toBe(false);
    expect(isBearerTokenAuthorized("worker-token", ["service-token", "worker-token"])).toBe(false);
    expect(isBearerTokenAuthorized("Bearer other-token", ["service-token", "worker-token"])).toBe(
      false,
    );
    expect(isBearerTokenAuthorized("Bearer worker-token", [undefined, " "])).toBe(false);
  });
});

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
