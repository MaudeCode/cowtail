import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { openclawEventTypes } from "@maudecode/cowtail-protocol";

import {
  itemAnswerValidator,
  itemEventTypeValidator,
  itemFields,
  itemUrgencyValidator,
  quietHoursValidator,
} from "./itemValidators";
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
    ownerDisposition: v.optional(v.union(v.literal("noise"), v.literal("escalated"))),
    ownerNote: v.optional(v.string()),
    ownerUpdatedAt: v.optional(v.number()),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_fingerprint_startsAt", ["alertmanagerFingerprint", "startsAt"])
    .index("by_fingerprint_status", ["alertmanagerFingerprint", "status"])
    .index("by_fingerprint_timestamp", ["alertmanagerFingerprint", "timestamp"])
    .index("by_alertname_namespace_timestamp", ["alertname", "namespace", "timestamp"])
    .index("by_sourceEventId", ["sourceEventId"])
    .index("by_status_timestamp", ["status", "timestamp"]),

  items: defineTable(itemFields)
    .index("by_state_updatedAt", ["state", "updatedAt"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_source_createdAt", ["source", "createdAt"])
    .index("by_alertId", ["alertId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_state_expiresAt", ["state", "expiresAt"])
    .index("by_state_snoozedUntil", ["state", "snoozedUntil"])
    .index("by_answeredAt", ["answeredAt"]),

  // Registered producers of items. A producer with a token posts as itself; only the token's
  // SHA-256 digest is stored.
  sources: defineTable({
    slug: v.string(),
    displayName: v.string(),
    iconStorageId: v.optional(v.id("_storage")),
    tokenHash: v.optional(v.string()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_tokenHash", ["tokenHash"]),

  itemEvents: defineTable({
    itemId: v.id("items"),
    at: v.number(),
    type: itemEventTypeValidator,
    actor: v.string(),
    payload: v.record(v.string(), v.any()),
  }).index("by_item_at", ["itemId", "at"]),

  // Planned work: alerts it covers are silenced in Alertmanager, and items it covers do not
  // push. `endedAt` is set when the owner ends it before `endsAt`.
  maintenanceWindows: defineTable({
    title: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    endedAt: v.optional(v.number()),
    createdBy: v.string(),
    // Alert labels that must equal these values, ANDed.
    matchers: v.array(v.object({ label: v.string(), value: v.string() })),
    // Item sources it covers; `*` is every source and `alertmanager` every alert.
    sources: v.array(v.string()),
    silenceIds: v.array(v.string()),
    silenceError: v.optional(v.string()),
    // A silence request went unanswered, so Alertmanager may hold one Cowtail has no id for.
    silenceUnconfirmed: v.optional(v.boolean()),
    // The client's id for the start request, so a retried start finds its window.
    requestId: v.optional(v.string()),
  })
    .index("by_endsAt", ["endsAt"])
    .index("by_requestId", ["requestId"]),

  // `today` items wait here for one summary push when the window ends.
  itemPushBatches: defineTable({
    windowEndsAt: v.number(),
    itemIds: v.array(v.id("items")),
    sentAt: v.optional(v.number()),
  }).index("by_sentAt", ["sentAt"]),

  // Hermes outbound webhook deliveries already ingested, so a redelivery stores nothing.
  hermesHookDeliveries: defineTable({
    deliveryId: v.string(),
    receivedAt: v.number(),
  })
    .index("by_deliveryId", ["deliveryId"])
    .index("by_receivedAt", ["receivedAt"]),

  // An owner's answer to an item with a `replyTo`, waiting for Hermes to claim and apply it.
  itemResponses: defineTable({
    itemId: v.id("items"),
    answer: itemAnswerValidator,
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    // When the row can next be claimed: its creation, then the end of each lease.
    availableAt: v.number(),
    claimToken: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status_availableAt", ["status", "availableAt"])
    .index("by_itemId_status", ["itemId", "status"]),

  // A runbook script the owner asked Hermes to run. Queued until Hermes claims it; a claim
  // whose lease ran out goes back to whichever Hermes claims next.
  runbookRuns: defineTable({
    scriptId: v.string(),
    scriptName: v.string(),
    itemId: v.optional(v.id("items")),
    requestedBy: v.string(),
    // The client's name for the request, so one sent again queues nothing.
    requestId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    // When Hermes said it was starting the script; from then on the run is never run again.
    executingAt: v.optional(v.number()),
    // When the row can next be claimed: its creation, then the end of each lease.
    availableAt: v.number(),
    claimToken: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
    attempts: v.number(),
    // The next output batch the current claim may send.
    nextSeq: v.number(),
    outputChunks: v.number(),
    outputBytes: v.number(),
    truncated: v.boolean(),
    exitCode: v.optional(v.number()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_status_availableAt", ["status", "availableAt"])
    .index("by_scriptId_status", ["scriptId", "status"])
    .index("by_requestId", ["requestId"])
    .index("by_createdAt", ["createdAt"]),

  // A run's output, in the order it arrived.
  runbookRunOutput: defineTable({
    runId: v.id("runbookRuns"),
    seq: v.number(),
    text: v.string(),
  }).index("by_run_seq", ["runId", "seq"]),

  // One row: the latest Hermes heartbeat.
  hermesStatus: defineTable({
    receivedAt: v.number(),
    snapshot: v.any(),
  }),

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
    investigationAlertIds: v.optional(v.array(v.id("alerts"))),
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
    claimCheckState: v.optional(v.union(v.literal("waiting"), v.literal("finished"))),
    recoveryAttempt: v.optional(v.number()),
    recoveredFrom: v.optional(v.id("jobDeliveries")),
    jobAttempts: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_jobId", ["jobId"])
    .index("by_status_claimCheckState_nextAttemptAt", [
      "status",
      "claimCheckState",
      "nextAttemptAt",
    ])
    .index("by_target_status", ["target", "status"]),

  deviceRegistrations: defineTable({
    userId: v.string(),
    deviceToken: v.string(),
    platform: v.string(),
    environment: v.string(),
    enabled: v.boolean(),
    deviceName: v.optional(v.string()),
    // The app session that registered the device; pushes stop when that session ends.
    // Absent when an Apple identity token registered it.
    sessionId: v.optional(v.id("authSessions")),
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
    quietHours: v.optional(quietHoursValidator),
    urgencyOverrides: v.optional(v.record(v.string(), itemUrgencyValidator)),
    requireAuthForApprovals: v.optional(v.boolean()),
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

  // One OIDC sign-in in flight. The state, PKCE verifier and nonce live only until the
  // callback consumes the row; an iOS login then holds a 60-second hand-off code hash.
  oidcLogins: defineTable({
    stateHash: v.string(),
    codeVerifier: v.string(),
    nonce: v.string(),
    client: v.union(v.literal("web"), v.literal("ios")),
    handoffChallenge: v.optional(v.string()),
    handoffCodeHash: v.optional(v.string()),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_handoffCodeHash", ["handoffCodeHash"])
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

  // One row: when the Alertmanager Watchdog first and last reached Cowtail.
  pipelineStatus: defineTable({
    firstWatchdogAt: v.number(),
    lastWatchdogAt: v.number(),
  }),

  openclawState: defineTable({
    key: v.string(),
    nextSequence: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
