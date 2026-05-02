import { v } from "convex/values";

export const openclawToolCallValidator = v.object({
  id: v.string(),
  name: v.string(),
  args: v.optional(v.record(v.string(), v.any())),
  result: v.optional(v.any()),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("complete"),
    v.literal("error"),
  ),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  insertedAtContentLength: v.optional(v.number()),
  contentSnapshotAtStart: v.optional(v.string()),
});

export const openclawToolCallsValidator = v.optional(v.array(openclawToolCallValidator));
