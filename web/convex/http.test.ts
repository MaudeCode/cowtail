import { describe, expect, test } from "bun:test";

import {
  isBearerTokenAuthorized,
  parseInvestigationOutcome,
  requireCowtailOwner,
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

describe("owner alert actions", () => {
  test("requires the configured Cowtail owner", () => {
    const previousOwner = process.env.COWTAIL_OWNER_USER_ID;
    const previousOpenClawOwner = process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;
    try {
      process.env.COWTAIL_OWNER_USER_ID = "owner-user";
      delete process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;

      expect(requireCowtailOwner({ userId: "owner-user" })).toBeNull();
      expect(requireCowtailOwner({ userId: "different-user" })?.status).toBe(403);

      delete process.env.COWTAIL_OWNER_USER_ID;
      expect(requireCowtailOwner({ userId: "owner-user" })?.status).toBe(500);
    } finally {
      if (previousOwner === undefined) delete process.env.COWTAIL_OWNER_USER_ID;
      else process.env.COWTAIL_OWNER_USER_ID = previousOwner;
      if (previousOpenClawOwner === undefined) delete process.env.COWTAIL_OPENCLAW_OWNER_USER_ID;
      else process.env.COWTAIL_OPENCLAW_OWNER_USER_ID = previousOpenClawOwner;
    }
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
