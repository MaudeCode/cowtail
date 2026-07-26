import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { openclawEventTypes } from "@maudecode/cowtail-protocol";

import { openclawToolCallsValidator } from "./openclawValidators";

export default defineSchema({
  alerts: defineTable({
    timestamp: v.number(),
    alertname: v.string(),
    severity: v.string(),
    namespace: v.string(),
    node: v.optional(v.string()),
    status: v.string(),
    outcome: v.string(),
    summary: v.string(),
    action: v.string(),
    rootCause: v.optional(v.string()),
    messaged: v.boolean(),
    resolvedAt: v.optional(v.number()),
    source: v.optional(
      v.union(
        v.literal("alertmanager"),
        v.literal("hermes"),
        v.literal("manual"),
        v.literal("weekly-review"),
      ),
    ),
    sourceEventId: v.optional(v.id("alertmanagerEvents")),
    alertmanagerFingerprint: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    generatorURL: v.optional(v.string()),
    labels: v.optional(v.record(v.string(), v.any())),
    annotations: v.optional(v.record(v.string(), v.any())),
    lastReceivedAt: v.optional(v.number()),
    occurrenceCount: v.optional(v.number()),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_fingerprint_startsAt", ["alertmanagerFingerprint", "startsAt"])
    .index("by_fingerprint_status", ["alertmanagerFingerprint", "status"])
    .index("by_sourceEventId", ["sourceEventId"])
    .index("by_status_timestamp", ["status", "timestamp"]),

  alertmanagerEvents: defineTable({
    receivedAt: v.number(),
    source: v.literal("alertmanager"),
    receiver: v.optional(v.string()),
    status: v.string(),
    groupKey: v.optional(v.string()),
    groupLabels: v.record(v.string(), v.any()),
    externalURL: v.optional(v.string()),
    version: v.optional(v.string()),
    truncatedAlerts: v.optional(v.number()),
    commonLabels: v.record(v.string(), v.any()),
    commonAnnotations: v.record(v.string(), v.any()),
    rawPayload: v.any(),
    payloadHash: v.string(),
    createdAlertIds: v.array(v.id("alerts")),
    createdJobIds: v.array(v.id("investigationJobs")),
    ingestStatus: v.union(v.literal("stored"), v.literal("normalized"), v.literal("failed")),
    error: v.optional(v.string()),
  })
    .index("by_receivedAt", ["receivedAt"])
    .index("by_payloadHash", ["payloadHash"])
    .index("by_groupKey", ["groupKey"])
    .index("by_ingestStatus_receivedAt", ["ingestStatus", "receivedAt"]),

  investigationJobs: defineTable({
    alertId: v.id("alerts"),
    sourceEventId: v.id("alertmanagerEvents"),
    fingerprint: v.string(),
    dedupeKey: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("deadletter"),
    ),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    attempts: v.number(),
    maxAttempts: v.number(),
    nextAttemptAt: v.number(),
    claimedBy: v.optional(v.string()),
    claimToken: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    lastError: v.optional(v.string()),
    errorHistory: v.array(
      v.object({
        at: v.number(),
        phase: v.string(),
        error: v.string(),
        retryable: v.boolean(),
      }),
    ),
    completedAt: v.optional(v.number()),
    deadletteredAt: v.optional(v.number()),
    deadletterReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_alertId", ["alertId"])
    .index("by_fingerprint_status", ["fingerprint", "status"])
    .index("by_claimToken", ["claimToken"]),

  jobDeliveries: defineTable({
    jobId: v.id("investigationJobs"),
    target: v.literal("hermes:cowtail-alert-job"),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.number(),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_jobId", ["jobId"])
    .index("by_target_status", ["target", "status"]),

  deviceRegistrations: defineTable({
    userId: v.string(),
    deviceToken: v.string(),
    platform: v.string(),
    environment: v.string(),
    enabled: v.boolean(),
    deviceName: v.optional(v.string()),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_deviceToken", ["deviceToken"])
    .index("by_enabled", ["enabled"])
    .index("by_userId_enabled", ["userId", "enabled"]),

  userNotificationPreferences: defineTable({
    userId: v.string(),
    dailyRoundupEnabled: v.boolean(),
    lastRoundupKeySent: v.optional(v.string()),
    inFlightRoundupKey: v.optional(v.string()),
    inFlightRoundupClaimedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_dailyRoundupEnabled", ["dailyRoundupEnabled"]),

  userOpenClawPreferences: defineTable({
    userId: v.string(),
    displayName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  authSessions: defineTable({
    userId: v.string(),
    tokenHash: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  fixes: defineTable({
    timestamp: v.number(),
    alertIds: v.array(v.id("alerts")),
    description: v.string(),
    rootCause: v.string(),
    commit: v.optional(v.string()),
    scope: v.union(v.literal("reactive"), v.literal("weekly"), v.literal("monthly")),
  }).index("by_timestamp", ["timestamp"]),

  openclawThreads: defineTable({
    sessionKey: v.optional(v.string()),
    title: v.string(),
    targetAgent: v.literal("default"),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("archived")),
    unreadCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.optional(v.number()),
  })
    .index("by_sessionKey", ["sessionKey"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  openclawMessages: defineTable({
    threadId: v.id("openclawThreads"),
    streamId: v.optional(v.string()),
    direction: v.union(v.literal("openclaw_to_user"), v.literal("user_to_openclaw")),
    authorLabel: v.optional(v.string()),
    text: v.string(),
    links: v.array(v.object({ label: v.string(), url: v.string() })),
    toolCalls: openclawToolCallsValidator,
    deliveryState: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  openclawActions: defineTable({
    threadId: v.id("openclawThreads"),
    messageId: v.id("openclawMessages"),
    label: v.string(),
    kind: v.string(),
    payload: v.record(v.string(), v.any()),
    state: v.union(
      v.literal("pending"),
      v.literal("submitted"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    resultMetadata: v.optional(v.record(v.string(), v.any())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_thread", ["threadId"]),

  openclawEvents: defineTable({
    sequence: v.number(),
    type: v.union(...openclawEventTypes.map((type) => v.literal(type))),
    threadId: v.optional(v.id("openclawThreads")),
    messageId: v.optional(v.id("openclawMessages")),
    actionId: v.optional(v.id("openclawActions")),
    payload: v.optional(v.record(v.string(), v.any())),
    createdAt: v.number(),
  }).index("by_sequence", ["sequence"]),

  openclawIdempotencyReceipts: defineTable({
    idempotencyKey: v.string(),
    commandType: v.string(),
    commandDigest: v.string(),
    sequence: v.number(),
    sessionKey: v.optional(v.string()),
    threadId: v.optional(v.id("openclawThreads")),
    messageId: v.optional(v.id("openclawMessages")),
    actionId: v.optional(v.id("openclawActions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_idempotencyKey", ["idempotencyKey"]),

  openclawState: defineTable({
    key: v.string(),
    nextSequence: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
