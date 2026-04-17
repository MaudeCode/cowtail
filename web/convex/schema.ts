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
});
