import { describe, expect, test } from "bun:test";

import {
  alertLifecycleDedupeKey,
  alertmanagerFingerprint,
  resolveAlertLifecyclePatch,
} from "./alertLifecycle";

describe("Alertmanager lifecycle identity", () => {
  test("uses one identity for firing and resolved notifications", () => {
    const fingerprint = "a76a8dab7eff3807";
    const startsAt = Date.parse("2026-07-26T14:27:49.665Z");

    expect(alertLifecycleDedupeKey(fingerprint, startsAt)).toBe(
      JSON.stringify([fingerprint, startsAt]),
    );
  });

  test("separates later occurrences of the same label set", () => {
    const fingerprint = "a76a8dab7eff3807";

    expect(alertLifecycleDedupeKey(fingerprint, 100)).not.toBe(
      alertLifecycleDedupeKey(fingerprint, 200),
    );
  });

  test("derives a stable fallback fingerprint from labels only", () => {
    expect(alertmanagerFingerprint(undefined, { severity: "warning", alertname: "Probe" })).toBe(
      alertmanagerFingerprint(" ", { alertname: "Probe", severity: "warning" }),
    );
  });
});

describe("Alertmanager lifecycle transitions", () => {
  const resolvedDisposition = {
    outcome: "self-resolved",
    action: "Alertmanager reported this alert resolved.",
  };

  test("moves a pending alert to resolved in place", () => {
    expect(
      resolveAlertLifecyclePatch(
        { status: "firing", outcome: "pending" },
        { status: "resolved", endsAt: 200 },
        resolvedDisposition,
      ),
    ).toEqual({
      status: "resolved",
      endsAt: 200,
      resolvedAt: 200,
      ...resolvedDisposition,
    });
  });

  test("moves a ledger-only alert from recorded to self-resolved", () => {
    expect(
      resolveAlertLifecyclePatch(
        { status: "firing", outcome: "recorded" },
        { status: "resolved", endsAt: 200 },
        resolvedDisposition,
      ),
    ).toMatchObject({ status: "resolved", outcome: "self-resolved" });
  });

  test("preserves a stronger investigation outcome when Alertmanager resolves", () => {
    expect(
      resolveAlertLifecyclePatch(
        { status: "firing", outcome: "fixed" },
        { status: "resolved", endsAt: 200 },
        resolvedDisposition,
      ),
    ).toEqual({ status: "resolved", endsAt: 200, resolvedAt: 200 });
  });

  test("does not reopen a resolved lifecycle from a stale firing delivery", () => {
    expect(
      resolveAlertLifecyclePatch(
        { status: "resolved", outcome: "self-resolved" },
        { status: "firing" },
        { outcome: "pending", action: "Investigation pending." },
      ),
    ).toEqual({});
  });
});
