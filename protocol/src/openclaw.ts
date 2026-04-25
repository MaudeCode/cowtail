import { z } from "zod";

import { jsonObjectSchema, nonEmptyStringSchema, timestampSchema } from "./shared.js";

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
  actions: z.array(openclawActionRecordSchema).optional(),
  payload: jsonObjectSchema.optional(),
  error: nonEmptyStringSchema.optional(),
});

export const openclawActionSubmittedEventSchema = openclawEventEnvelopeSchema.extend({
  type: z.literal("action_submitted"),
  threadId: nonEmptyStringSchema,
  actionId: nonEmptyStringSchema,
  payload: jsonObjectSchema,
});

export const openclawRequestIdSchema = nonEmptyStringSchema;

export const openclawActionDraftSchema = z.object({
  label: nonEmptyStringSchema,
  kind: nonEmptyStringSchema,
  payload: jsonObjectSchema,
});

export const openclawPluginMessageCommandSchema = z.object({
  type: z.literal("openclaw_message"),
  requestId: openclawRequestIdSchema,
  sessionKey: nonEmptyStringSchema,
  title: nonEmptyStringSchema.optional(),
  text: nonEmptyStringSchema,
  authorLabel: nonEmptyStringSchema.optional(),
  links: z.array(openclawLinkSchema).default([]),
  actions: z.array(openclawActionDraftSchema).default([]),
});

export const openclawIosNewThreadCommandSchema = z.object({
  type: z.literal("ios_new_thread"),
  requestId: openclawRequestIdSchema,
  title: nonEmptyStringSchema.optional(),
  text: nonEmptyStringSchema,
});

export const openclawIosReplyCommandSchema = z.object({
  type: z.literal("ios_reply"),
  requestId: openclawRequestIdSchema,
  threadId: nonEmptyStringSchema,
  text: nonEmptyStringSchema,
});

export const openclawIosActionCommandSchema = z.object({
  type: z.literal("ios_action"),
  requestId: openclawRequestIdSchema,
  actionId: nonEmptyStringSchema,
  payload: jsonObjectSchema,
});

export const openclawIosMarkThreadReadCommandSchema = z.object({
  type: z.literal("ios_mark_thread_read"),
  requestId: openclawRequestIdSchema,
  threadId: nonEmptyStringSchema,
});

export const openclawSessionBoundCommandSchema = z.object({
  type: z.literal("openclaw_session_bound"),
  requestId: openclawRequestIdSchema,
  threadId: nonEmptyStringSchema,
  sessionKey: nonEmptyStringSchema,
});

export const openclawActionResultCommandSchema = z.object({
  type: z.literal("openclaw_action_result"),
  requestId: openclawRequestIdSchema,
  actionId: nonEmptyStringSchema,
  state: z.enum(["submitted", "failed", "expired"]),
  resultMetadata: jsonObjectSchema.optional(),
});

export const openclawRealtimeClientMessageSchema = z.discriminatedUnion("type", [
  openclawPluginMessageCommandSchema,
  openclawIosNewThreadCommandSchema,
  openclawIosReplyCommandSchema,
  openclawIosActionCommandSchema,
  openclawIosMarkThreadReadCommandSchema,
  openclawSessionBoundCommandSchema,
  openclawActionResultCommandSchema,
]);

export const openclawRealtimeAckSchema = z.object({
  type: z.literal("ack"),
  requestId: openclawRequestIdSchema,
  sequence: openclawSequenceSchema.optional(),
});

export const openclawRealtimeErrorSchema = z.object({
  type: z.literal("realtime_error"),
  requestId: openclawRequestIdSchema.optional(),
  error: nonEmptyStringSchema,
});

export const openclawRealtimeServerMessageSchema = z.union([
  openclawEventEnvelopeSchema,
  openclawRealtimeAckSchema,
  openclawRealtimeErrorSchema,
]);

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

export const openclawMessageWithActionsRecordSchema = openclawMessageRecordSchema.extend({
  actions: z.array(openclawActionRecordSchema).default([]),
});

export const openclawMessageWithActionsListResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  messages: z.array(openclawMessageWithActionsRecordSchema),
});

export const openclawDisplayPreferencesSchema = z.object({
  displayName: nonEmptyStringSchema.default("OpenClaw"),
});

export const openclawDisplayPreferencesResponseSchema = z.object({
  ok: z.literal(true),
  preferences: openclawDisplayPreferencesSchema,
});

export const openclawDisplayPreferencesUpdateRequestSchema = z.object({
  displayName: nonEmptyStringSchema,
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
export type OpenClawRequestId = z.infer<typeof openclawRequestIdSchema>;
export type OpenClawActionDraft = z.infer<typeof openclawActionDraftSchema>;
export type OpenClawRealtimeClientMessage = z.infer<typeof openclawRealtimeClientMessageSchema>;
export type OpenClawPluginMessageCommand = z.infer<typeof openclawPluginMessageCommandSchema>;
export type OpenClawIosNewThreadCommand = z.infer<typeof openclawIosNewThreadCommandSchema>;
export type OpenClawIosReplyCommand = z.infer<typeof openclawIosReplyCommandSchema>;
export type OpenClawIosActionCommand = z.infer<typeof openclawIosActionCommandSchema>;
export type OpenClawIosMarkThreadReadCommand = z.infer<
  typeof openclawIosMarkThreadReadCommandSchema
>;
export type OpenClawSessionBoundCommand = z.infer<typeof openclawSessionBoundCommandSchema>;
export type OpenClawActionResultCommand = z.infer<typeof openclawActionResultCommandSchema>;
export type OpenClawRealtimeAck = z.infer<typeof openclawRealtimeAckSchema>;
export type OpenClawRealtimeError = z.infer<typeof openclawRealtimeErrorSchema>;
export type OpenClawRealtimeServerMessage = z.infer<typeof openclawRealtimeServerMessageSchema>;
export type OpenClawSequence = z.infer<typeof openclawSequenceSchema>;
export type OpenClawThreadListResponse = z.infer<typeof openclawThreadListResponseSchema>;
export type OpenClawMessageListResponse = z.infer<typeof openclawMessageListResponseSchema>;
export type OpenClawMessageWithActionsRecord = z.infer<
  typeof openclawMessageWithActionsRecordSchema
>;
export type OpenClawMessageWithActionsListResponse = z.infer<
  typeof openclawMessageWithActionsListResponseSchema
>;
export type OpenClawDisplayPreferences = z.infer<typeof openclawDisplayPreferencesSchema>;
export type OpenClawDisplayPreferencesResponse = z.infer<
  typeof openclawDisplayPreferencesResponseSchema
>;
export type OpenClawDisplayPreferencesUpdateRequest = z.infer<
  typeof openclawDisplayPreferencesUpdateRequestSchema
>;
export type OpenClawEventReplayResponse = z.infer<typeof openclawEventReplayResponseSchema>;
export type OpenClawClientHello = z.infer<typeof openclawClientHelloSchema>;
export type OpenClawThreadRecord = z.infer<typeof openclawThreadRecordSchema>;
export type OpenClawMessageRecord = z.infer<typeof openclawMessageRecordSchema>;
export type OpenClawActionRecord = z.infer<typeof openclawActionRecordSchema>;
export type OpenClawEventEnvelope = z.infer<typeof openclawEventEnvelopeSchema>;
export type OpenClawReplayQuery = z.infer<typeof openclawReplayQuerySchema>;
