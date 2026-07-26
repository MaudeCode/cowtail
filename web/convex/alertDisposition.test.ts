import { describe, expect, test } from "bun:test";

import { resolveInitialAlertDisposition } from "./alertDisposition";

describe("initial Alertmanager disposition", () => {
  test("only firing alerts with a requested investigation start pending", () => {
    expect(resolveInitialAlertDisposition("firing", true)).toEqual({
      outcome: "pending",
      action: "Recorded by Cowtail Alertmanager ingest. Investigation pending.",
    });
  });

  test("ledger-only firing alerts are recorded instead of pending", () => {
    expect(resolveInitialAlertDisposition("firing", false)).toEqual({
      outcome: "recorded",
      action: "Recorded by Cowtail Alertmanager ingest. No immediate investigation requested.",
    });
  });

  test("resolved notifications are self-resolved even on the investigate receiver", () => {
    expect(resolveInitialAlertDisposition("resolved", true)).toEqual({
      outcome: "self-resolved",
      action: "Alertmanager reported this alert resolved.",
    });
  });
});
