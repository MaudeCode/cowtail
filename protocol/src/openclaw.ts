import { z } from "zod";

import {
  jsonObjectSchema,
  nonEmptyStringSchema,
  timestampSchema,
} from "./shared.js";

export const openclawEventTypes = [
  "hello_acknowledged",
  "thread_created",
  "thread_updated",
  "message_created",
  "message_acknowledged",
  "reply_created",
  "action_submitted",
  "action_result",
  "session_bound",
  "error",
] as const;

export const openclawProtocolVersionSchema = z.literal(1);
export const openclawClientKindSchema = z.enum(["openclaw_plugin", "ios"]);
export const openclawThreadStatusSchema = z.enum(["pending", "active", "archived"]);
export const openclawTargetAgentSchema = z.literal("default");
export const openclawMessageDirectionSchema = z.enum(["openclaw_to_user", "user_to_openclaw"]);
export const openclawDeliveryStateSchema = z.enum(["pending", "sent", "failed"]);
export const openclawActionStateSchema = z.enum(["pending", "submitted", "failed", "expired"]);
export const openclawEventTypeSchema = z.enum(openclawEventTypes);
export const openclawSequenceSchema = z.number().int().nonnegative();

export const openclawLinkSchema = z.object({
  label: nonEmptyStringSchema,
  url: nonEmptyStringSchema,
});

const openclawPluginClientHelloSchema = z.object({
  protocolVersion: openclawProtocolVersionSchema,
  clientKind: z.literal("openclaw_plugin"),
  token: nonEmptyStringSchema,
  lastSeenSequence: openclawSequenceSchema.optional(),
});

const openclawIosClientHelloSchema = z.object({
  protocolVersion: openclawProtocolVersionSchema,
  clientKind: z.literal("ios"),
  appSessionToken: nonEmptyStringSchema,
  lastSeenSequence: openclawSequenceSchema.optional(),
});

export const openclawClientHelloSchema = z.discriminatedUnion("clientKind", [
  openclawPluginClientHelloSchema,
  openclawIosClientHelloSchema,
]);

export const openclawThreadRecordSchema = z.object({
  id: nonEmptyStringSchema,
  sessionKey: nonEmptyStringSchema.optional(),
  status: openclawThreadStatusSchema,
  targetAgent: openclawTargetAgentSchema,
  title: nonEmptyStringSchema,
  unreadCount: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastMessageAt: timestampSchema.optional(),
});

export const openclawMessageRecordSchema = z.object({
  id: nonEmptyStringSchema,
  threadId: nonEmptyStringSchema,
  direction: openclawMessageDirectionSchema,
  authorLabel: nonEmptyStringSchema.optional(),
  text: nonEmptyStringSchema,
  links: z.array(openclawLinkSchema).default([]),
  deliveryState: openclawDeliveryStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const openclawActionRecordSchema = z.object({
  id: nonEmptyStringSchema,
  threadId: nonEmptyStringSchema,
  messageId: nonEmptyStringSchema,
  label: nonEmptyStringSchema,
  kind: nonEmptyStringSchema,
  payload: jsonObjectSchema,
  state: openclawActionStateSchema,
  resultMetadata: jsonObjectSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const openclawEventEnvelopeSchema = z.object({
  sequence: openclawSequenceSchema,
  type: openclawEventTypeSchema,
  createdAt: timestampSchema,
  threadId: nonEmptyStringSchema.optional(),
  messageId: nonEmptyStringSchema.optional(),
  actionId: nonEmptyStringSchema.optional(),
  thread: openclawThreadRecordSchema.optional(),
  message: openclawMessageRecordSchema.optional(),
  action: openclawActionRecordSchema.optional(),
  payload: jsonObjectSchema.optional(),
  error: nonEmptyStringSchema.optional(),
});

export const openclawActionSubmittedEventSchema = openclawEventEnvelopeSchema.extend({
  type: z.literal("action_submitted"),
  threadId: nonEmptyStringSchema,
  actionId: nonEmptyStringSchema,
  payload: jsonObjectSchema,
});

export const openclawReplayQuerySchema = z.object({
  afterSequence: openclawSequenceSchema.optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export const openclawThreadListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  threads: z.array(openclawThreadRecordSchema),
});

export const openclawMessageListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  messages: z.array(openclawMessageRecordSchema),
});

export const openclawEventReplayResponseSchema = z.object({
  ok: z.literal(true),
  events: z.array(openclawEventEnvelopeSchema),
});

export type OpenClawProtocolVersion = z.infer<typeof openclawProtocolVersionSchema>;
export type OpenClawClientKind = z.infer<typeof openclawClientKindSchema>;
export type OpenClawThreadStatus = z.infer<typeof openclawThreadStatusSchema>;
export type OpenClawTargetAgent = z.infer<typeof openclawTargetAgentSchema>;
export type OpenClawMessageDirection = z.infer<typeof openclawMessageDirectionSchema>;
export type OpenClawDeliveryState = z.infer<typeof openclawDeliveryStateSchema>;
export type OpenClawActionState = z.infer<typeof openclawActionStateSchema>;
export type OpenClawEventType = z.infer<typeof openclawEventTypeSchema>;
export type OpenClawLink = z.infer<typeof openclawLinkSchema>;
export type OpenClawActionSubmittedEvent = z.infer<typeof openclawActionSubmittedEventSchema>;
export type OpenClawSequence = z.infer<typeof openclawSequenceSchema>;
export type OpenClawThreadListResponse = z.infer<typeof openclawThreadListResponseSchema>;
export type OpenClawMessageListResponse = z.infer<typeof openclawMessageListResponseSchema>;
export type OpenClawEventReplayResponse = z.infer<typeof openclawEventReplayResponseSchema>;
export type OpenClawClientHello = z.infer<typeof openclawClientHelloSchema>;
export type OpenClawThreadRecord = z.infer<typeof openclawThreadRecordSchema>;
export type OpenClawMessageRecord = z.infer<typeof openclawMessageRecordSchema>;
export type OpenClawActionRecord = z.infer<typeof openclawActionRecordSchema>;
export type OpenClawEventEnvelope = z.infer<typeof openclawEventEnvelopeSchema>;
export type OpenClawReplayQuery = z.infer<typeof openclawReplayQuerySchema>;
