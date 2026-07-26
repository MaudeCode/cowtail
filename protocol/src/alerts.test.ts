import { describe, expect, test } from "bun:test";

import { alertCreateRequestSchema, alertRecordSchema } from "./alerts.js";

describe("alert protocol schemas", () => {
  test("accepts pending and recorded outcomes for durable ingest", () => {
    const pending = alertCreateRequestSchema.parse({
      alertname: "KubePodCrashLooping",
      severity: "warning",
      namespace: "network",
      status: "firing",
      outcome: "pending",
      summary: "Pod is crash looping.",
      action: "Recorded by Cowtail Alertmanager ingest. Investigation pending.",
    });
    const recorded = alertCreateRequestSchema.parse({
      alertname: "CephPGNotDeepScrubbed",
      severity: "warning",
      namespace: "rook-ceph",
      status: "firing",
      outcome: "recorded",
      summary: "Placement group is overdue for a deep scrub.",
      action: "Recorded by Cowtail Alertmanager ingest. No immediate investigation requested.",
    });

    expect(pending.outcome).toBe("pending");
    expect(recorded.outcome).toBe("recorded");
  });

  test("keeps compact alert records backwards compatible", () => {
    expect(
      alertRecordSchema.parse({
        id: "alert-1",
        timestamp: 1780000000000,
        alertname: "TargetDown",
        severity: "warning",
        namespace: "observability",
        status: "resolved",
        outcome: "self-resolved",
        summary: "Target recovered.",
        action: "Recorded recovery.",
        messaged: false,
      }),
    ).toEqual({
      id: "alert-1",
      timestamp: 1780000000000,
      alertname: "TargetDown",
      severity: "warning",
      namespace: "observability",
      status: "resolved",
      outcome: "self-resolved",
      summary: "Target recovered.",
      action: "Recorded recovery.",
      messaged: false,
    });
  });

  test("accepts durable Alertmanager source fields", () => {
    const parsed = alertRecordSchema.parse({
      id: "alert-1",
      timestamp: 1780000000000,
      alertname: "KubePodCrashLooping",
      severity: "warning",
      namespace: "network",
      node: "k8s-oceanus",
      status: "firing",
      outcome: "pending",
      summary: "Pod is crash looping.",
      action: "Recorded by Cowtail Alertmanager ingest. Investigation pending.",
      messaged: false,
      source: "alertmanager",
      sourceEventId: "event-1",
      alertmanagerFingerprint: "7a7995c29114e866",
      dedupeKey: "7a7995c29114e866:firing:2026-07-04T21:14:33.181Z",
      startsAt: 1783199673181,
      generatorURL: "http://prometheus.thezoo.house/graph?...",
      labels: {
        alertname: "KubePodCrashLooping",
        namespace: "network",
        pod: "external-dns-unifi-56cc4ff699-hw9n9",
      },
      annotations: {
        summary: "Pod is crash looping.",
      },
      lastReceivedAt: 1783200000000,
      occurrenceCount: 2,
    });

    expect(parsed.source).toBe("alertmanager");
    expect(parsed.alertmanagerFingerprint).toBe("7a7995c29114e866");
    expect(parsed.labels?.pod).toBe("external-dns-unifi-56cc4ff699-hw9n9");
    expect(parsed.occurrenceCount).toBe(2);
  });
});
