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
});
