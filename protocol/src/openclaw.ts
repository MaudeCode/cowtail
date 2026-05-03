import { z } from "zod";

import { jsonObjectSchema, nonEmptyStringSchema, timestampSchema } from "./shared.js";

export const openclawEventTypes = [
  "hello_acknowledged",
  "thread_created",
  "thread_updated",
  "message_created",
  "message_updated",
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
export const openclawToolCallStatusSchema = z.enum(["pending", "running", "complete", "error"]);
export const openclawEventTypeSchema = z.enum(openclawEventTypes);
export const openclawSequenceSchema = z.number().int().nonnegative();
export const openclawMessageTextSchema = z.string();

function hasOpenClawRenderableContent(value: {
  text: string;
  links?: unknown[];
  toolCalls?: unknown[];
  actions?: unknown[];
}): boolean {
  return (
    value.text.trim().length > 0 ||
    (value.links?.length ?? 0) > 0 ||
    (value.toolCalls?.length ?? 0) > 0 ||
    (value.actions?.length ?? 0) > 0
  );
}

function requireOpenClawRenderableContent<TSchema extends z.ZodObject>(schema: TSchema): TSchema {
  return schema.refine(
    (value) =>
      hasOpenClawRenderableContent(value as Parameters<typeof hasOpenClawRenderableContent>[0]),
    {
      message: "OpenClaw messages require text or renderable content",
      path: ["text"],
    },
  ) as unknown as TSchema;
}

export const openclawLinkSchema = z.object({
  label: nonEmptyStringSchema,
  url: nonEmptyStringSchema,
});

export const openclawToolCallRecordSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  args: jsonObjectSchema.optional(),
  result: z.unknown().optional(),
  status: openclawToolCallStatusSchema,
  startedAt: timestampSchema.optional(),
  completedAt: timestampSchema.optional(),
  insertedAtContentLength: z.number().int().nonnegative().optional(),
  contentSnapshotAtStart: z.string().optional(),
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

const openclawMessageRecordBaseSchema = z.object({
  id: nonEmptyStringSchema,
  threadId: nonEmptyStringSchema,
  direction: openclawMessageDirectionSchema,
  authorLabel: nonEmptyStringSchema.optional(),
  text: openclawMessageTextSchema,
  links: z.array(openclawLinkSchema).default([]),
  toolCalls: z.array(openclawToolCallRecordSchema).default([]),
  deliveryState: openclawDeliveryStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const openclawMessageRecordSchema = requireOpenClawRenderableContent(
  openclawMessageRecordBaseSchema,
);

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
export const openclawIdempotencyKeySchema = nonEmptyStringSchema;

export const openclawActionDraftSchema = z.object({
  label: nonEmptyStringSchema,
  kind: nonEmptyStringSchema,
  payload: jsonObjectSchema,
});

export const openclawPluginMessageCommandSchema = requireOpenClawRenderableContent(
  z.object({
    type: z.literal("openclaw_message"),
    requestId: openclawRequestIdSchema,
    idempotencyKey: openclawIdempotencyKeySchema,
    sessionKey: nonEmptyStringSchema,
    title: nonEmptyStringSchema.optional(),
    text: openclawMessageTextSchema,
    authorLabel: nonEmptyStringSchema.optional(),
    links: z.array(openclawLinkSchema).default([]),
    toolCalls: z.array(openclawToolCallRecordSchema).default([]),
    actions: z.array(openclawActionDraftSchema).default([]),
    deliveryState: openclawDeliveryStateSchema.optional(),
  }),
);

export const openclawPluginMessageUpdateCommandSchema = requireOpenClawRenderableContent(
  z.object({
    type: z.literal("openclaw_message_update"),
    requestId: openclawRequestIdSchema,
    idempotencyKey: openclawIdempotencyKeySchema,
    messageId: nonEmptyStringSchema,
    text: openclawMessageTextSchema,
    links: z.array(openclawLinkSchema).optional(),
    toolCalls: z.array(openclawToolCallRecordSchema).optional(),
    actions: z.array(openclawActionDraftSchema).optional(),
    deliveryState: openclawDeliveryStateSchema.optional(),
  }),
);

export const openclawIosNewThreadCommandSchema = z.object({
  type: z.literal("ios_new_thread"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  title: nonEmptyStringSchema.optional(),
  text: nonEmptyStringSchema,
});

export const openclawIosReplyCommandSchema = z.object({
  type: z.literal("ios_reply"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  threadId: nonEmptyStringSchema,
  text: nonEmptyStringSchema,
});

export const openclawIosActionCommandSchema = z.object({
  type: z.literal("ios_action"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  actionId: nonEmptyStringSchema,
  payload: jsonObjectSchema,
});

export const openclawIosMarkThreadReadCommandSchema = z.object({
  type: z.literal("ios_mark_thread_read"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  threadId: nonEmptyStringSchema,
});

export const openclawIosRenameThreadCommandSchema = z.object({
  type: z.literal("ios_rename_thread"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  threadId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
});

export const openclawIosDeleteThreadCommandSchema = z.object({
  type: z.literal("ios_delete_thread"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  threadId: nonEmptyStringSchema,
});

export const openclawSessionBoundCommandSchema = z.object({
  type: z.literal("openclaw_session_bound"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  threadId: nonEmptyStringSchema,
  sessionKey: nonEmptyStringSchema,
});

export const openclawActionResultCommandSchema = z.object({
  type: z.literal("openclaw_action_result"),
  requestId: openclawRequestIdSchema,
  idempotencyKey: openclawIdempotencyKeySchema,
  actionId: nonEmptyStringSchema,
  state: z.enum(["submitted", "failed", "expired"]),
  resultMetadata: jsonObjectSchema.optional(),
});

export const openclawRealtimeClientMessageSchema = z.union([
  openclawPluginMessageCommandSchema,
  openclawPluginMessageUpdateCommandSchema,
  openclawIosNewThreadCommandSchema,
  openclawIosReplyCommandSchema,
  openclawIosActionCommandSchema,
  openclawIosMarkThreadReadCommandSchema,
  openclawIosRenameThreadCommandSchema,
  openclawIosDeleteThreadCommandSchema,
  openclawSessionBoundCommandSchema,
  openclawActionResultCommandSchema,
]);

export const openclawRealtimeAckSchema = z.object({
  type: z.literal("ack"),
  requestId: openclawRequestIdSchema,
  sequence: openclawSequenceSchema.optional(),
  payload: jsonObjectSchema.optional(),
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

export const openclawMessageWithActionsRecordSchema = requireOpenClawRenderableContent(
  openclawMessageRecordBaseSchema.extend({
    actions: z.array(openclawActionRecordSchema).default([]),
  }),
);

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
export type OpenClawToolCallStatus = z.infer<typeof openclawToolCallStatusSchema>;
export type OpenClawEventType = z.infer<typeof openclawEventTypeSchema>;
export type OpenClawLink = z.infer<typeof openclawLinkSchema>;
export type OpenClawToolCallRecord = z.infer<typeof openclawToolCallRecordSchema>;
export type OpenClawActionSubmittedEvent = z.infer<typeof openclawActionSubmittedEventSchema>;
export type OpenClawRequestId = z.infer<typeof openclawRequestIdSchema>;
export type OpenClawActionDraft = z.infer<typeof openclawActionDraftSchema>;
export type OpenClawRealtimeClientMessage = z.infer<typeof openclawRealtimeClientMessageSchema>;
export type OpenClawPluginMessageCommand = z.infer<typeof openclawPluginMessageCommandSchema>;
export type OpenClawPluginMessageUpdateCommand = z.infer<
  typeof openclawPluginMessageUpdateCommandSchema
>;
export type OpenClawIosNewThreadCommand = z.infer<typeof openclawIosNewThreadCommandSchema>;
export type OpenClawIosReplyCommand = z.infer<typeof openclawIosReplyCommandSchema>;
export type OpenClawIosActionCommand = z.infer<typeof openclawIosActionCommandSchema>;
export type OpenClawIosMarkThreadReadCommand = z.infer<
  typeof openclawIosMarkThreadReadCommandSchema
>;
export type OpenClawIosRenameThreadCommand = z.infer<typeof openclawIosRenameThreadCommandSchema>;
export type OpenClawIosDeleteThreadCommand = z.infer<typeof openclawIosDeleteThreadCommandSchema>;
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
