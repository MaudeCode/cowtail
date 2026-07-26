import { describe, expect, test } from "bun:test";

import { buildHermesJobNotification, isHermesSchedulingAcknowledged } from "./jobDeliveryActions";

describe("Hermes alert-job delivery", () => {
  test("builds the typed webhook payload from the durable job and alert", () => {
    expect(
      buildHermesJobNotification(
        {
          _id: "job-123",
          alertId: "alert-456",
          fingerprint: "fingerprint-789",
          status: "queued",
          createdAt: 1_785_067_964_393,
        },
        {
          alertname: "KubePodCrashLooping",
          severity: "warning",
        },
      ),
    ).toEqual({
      type: "cowtail.alert_job_available",
      jobId: "job-123",
      alertId: "alert-456",
      fingerprint: "fingerprint-789",
      alertname: "KubePodCrashLooping",
      severity: "warning",
      status: "queued",
      createdAt: 1_785_067_964_393,
    });
  });

  test("accepts only explicit scheduling acknowledgements for the same delivery", () => {
    expect(
      isHermesSchedulingAcknowledged(
        202,
        { status: "accepted", delivery_id: "delivery-123" },
        "delivery-123",
      ),
    ).toBe(true);
    expect(
      isHermesSchedulingAcknowledged(
        200,
        { status: "duplicate", delivery_id: "delivery-123" },
        "delivery-123",
      ),
    ).toBe(true);
    expect(
      isHermesSchedulingAcknowledged(
        200,
        { status: "ignored", reason: "filter", delivery_id: "delivery-123" },
        "delivery-123",
      ),
    ).toBe(false);
    expect(
      isHermesSchedulingAcknowledged(
        202,
        { status: "accepted", delivery_id: "another-delivery" },
        "delivery-123",
      ),
    ).toBe(false);
  });
});
