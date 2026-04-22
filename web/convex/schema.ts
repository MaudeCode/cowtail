import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  }).index("by_timestamp", ["timestamp"]),

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
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  openclawMessages: defineTable({
    threadId: v.id("openclawThreads"),
    direction: v.union(v.literal("openclaw_to_user"), v.literal("user_to_openclaw")),
    authorLabel: v.optional(v.string()),
    text: v.string(),
    links: v.array(v.object({ label: v.string(), url: v.string() })),
    deliveryState: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

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
    type: v.union(
      v.literal("hello_acknowledged"),
      v.literal("thread_created"),
      v.literal("thread_updated"),
      v.literal("message_created"),
      v.literal("message_acknowledged"),
      v.literal("reply_created"),
      v.literal("action_submitted"),
      v.literal("action_result"),
      v.literal("session_bound"),
      v.literal("error"),
    ),
    threadId: v.optional(v.id("openclawThreads")),
    messageId: v.optional(v.id("openclawMessages")),
    actionId: v.optional(v.id("openclawActions")),
    payload: v.optional(v.record(v.string(), v.any())),
    createdAt: v.number(),
  }).index("by_sequence", ["sequence"]),

  openclawState: defineTable({
    key: v.string(),
    nextSequence: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
