import type {
  OpenClawActionRecord,
  OpenClawActionState,
  OpenClawDeliveryState,
  OpenClawEventEnvelope,
  OpenClawEventType,
  OpenClawMessageDirection,
  OpenClawMessageRecord,
  OpenClawTargetAgent,
  OpenClawThreadRecord,
  OpenClawThreadStatus,
} from "@maudecode/cowtail-protocol";

type MessageLike<IdValue extends string = string> = {
  _id: IdValue;
  createdAt: number;
};

type DocumentId = string;

type StoredOpenClawThread = {
  _id: DocumentId;
  sessionKey?: string;
  status: OpenClawThreadStatus;
  targetAgent: OpenClawTargetAgent;
  title: string;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
};

type StoredOpenClawMessage = {
  _id: DocumentId;
  threadId: DocumentId;
  direction: OpenClawMessageDirection;
  authorLabel?: string;
  text: string;
  links: OpenClawMessageRecord["links"];
  deliveryState: OpenClawDeliveryState;
  createdAt: number;
  updatedAt: number;
};

type StoredOpenClawAction = {
  _id: DocumentId;
  threadId: DocumentId;
  messageId: DocumentId;
  label: string;
  kind: string;
  payload: Record<string, unknown>;
  state: OpenClawActionState;
  resultMetadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

type StoredOpenClawEvent = {
  sequence: number;
  type: OpenClawEventType;
  createdAt: number;
  threadId?: DocumentId;
  messageId?: DocumentId;
  actionId?: DocumentId;
  payload?: Record<string, unknown>;
  error?: string;
};

type OpenClawActionResultState = Extract<OpenClawActionState, "submitted" | "failed" | "expired">;

export type OpenClawEventPayloadInput = {
  type: OpenClawEventType;
  threadId?: string;
  messageId?: string;
  actionId?: string;
  payload?: Record<string, unknown>;
};

export function normalizeOpenClawTitle(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || "Main";
}

export function applyOpenClawThreadTitlePatch(
  existingTitle: string,
  incomingTitle: string | undefined,
): string {
  const trimmed = incomingTitle?.trim();
  if (!trimmed) {
    return existingTitle;
  }

  return trimmed;
}

export function validateOpenClawAfterSequence(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error("afterSequence must be a finite integer greater than or equal to 0");
  }

  return value;
}

export function validateOpenClawLimit(value: number | undefined): number {
  if (value === undefined) {
    return 100;
  }

  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }

  return value;
}

export function sortOpenClawMessagesAscending<
  IdValue extends string,
  T extends MessageLike<IdValue>,
>(messages: T[]): T[] {
  return [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    return left._id.localeCompare(right._id);
  });
}

export function toOpenClawThreadRecord(thread: StoredOpenClawThread): OpenClawThreadRecord {
  const record: OpenClawThreadRecord = {
    id: thread._id,
    status: thread.status,
    targetAgent: thread.targetAgent,
    title: thread.title,
    unreadCount: thread.unreadCount,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };

  if (thread.sessionKey !== undefined) {
    record.sessionKey = thread.sessionKey;
  }

  if (thread.lastMessageAt !== undefined) {
    record.lastMessageAt = thread.lastMessageAt;
  }

  return record;
}

export function toOpenClawMessageRecord(message: StoredOpenClawMessage): OpenClawMessageRecord {
  const record: OpenClawMessageRecord = {
    id: message._id,
    threadId: message.threadId,
    direction: message.direction,
    text: message.text,
    links: message.links,
    deliveryState: message.deliveryState,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };

  if (message.authorLabel !== undefined) {
    record.authorLabel = message.authorLabel;
  }

  return record;
}

export function toOpenClawActionRecord(action: StoredOpenClawAction): OpenClawActionRecord {
  const record: OpenClawActionRecord = {
    id: action._id,
    threadId: action.threadId,
    messageId: action.messageId,
    label: action.label,
    kind: action.kind,
    payload: action.payload,
    state: action.state,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };

  if (action.resultMetadata !== undefined) {
    record.resultMetadata = action.resultMetadata;
  }

  return record;
}

export function toOpenClawEventEnvelope({
  event,
  thread,
  message,
  action,
  actions,
}: {
  event: StoredOpenClawEvent;
  thread?: StoredOpenClawThread | null;
  message?: StoredOpenClawMessage | null;
  action?: StoredOpenClawAction | null;
  actions?: StoredOpenClawAction[] | null;
}): OpenClawEventEnvelope {
  const envelope: OpenClawEventEnvelope = {
    sequence: event.sequence,
    type: event.type,
    createdAt: event.createdAt,
  };

  if (event.threadId !== undefined) {
    envelope.threadId = event.threadId;
  }

  if (event.messageId !== undefined) {
    envelope.messageId = event.messageId;
  }

  if (event.actionId !== undefined) {
    envelope.actionId = event.actionId;
  }

  if (thread !== undefined && thread !== null) {
    envelope.thread = toOpenClawThreadRecord(thread);
  }

  if (message !== undefined && message !== null) {
    envelope.message = toOpenClawMessageRecord(message);
  }

  if (action !== undefined && action !== null) {
    envelope.action = toOpenClawActionRecord(action);
  }

  if (actions !== undefined && actions !== null && actions.length > 0) {
    envelope.actions = actions.map(toOpenClawActionRecord);
  }

  if (event.payload !== undefined) {
    envelope.payload = event.payload;
  }

  if (event.error !== undefined) {
    envelope.error = event.error;
  }

  return envelope;
}

export function buildOpenClawActionResultUpdate({
  state,
  resultMetadata,
  updatedAt,
}: {
  state: OpenClawActionResultState;
  resultMetadata?: Record<string, unknown>;
  updatedAt: number;
}): {
  actionPatch: {
    state: OpenClawActionResultState;
    updatedAt: number;
    resultMetadata?: Record<string, unknown>;
  };
  eventPayload: {
    state: OpenClawActionResultState;
    resultMetadata?: Record<string, unknown>;
  };
} {
  const actionPatch: {
    state: OpenClawActionResultState;
    updatedAt: number;
    resultMetadata?: Record<string, unknown>;
  } = {
    state,
    updatedAt,
  };
  const eventPayload: {
    state: OpenClawActionResultState;
    resultMetadata?: Record<string, unknown>;
  } = {
    state,
  };

  if (resultMetadata !== undefined) {
    actionPatch.resultMetadata = resultMetadata;
    eventPayload.resultMetadata = resultMetadata;
  }

  return { actionPatch, eventPayload };
}

export function buildOpenClawEventPayload(input: OpenClawEventPayloadInput) {
  const payload: OpenClawEventPayloadInput = {
    type: input.type,
  };

  if (input.threadId !== undefined) {
    payload.threadId = input.threadId;
  }

  if (input.messageId !== undefined) {
    payload.messageId = input.messageId;
  }

  if (input.actionId !== undefined) {
    payload.actionId = input.actionId;
  }

  if (input.payload !== undefined) {
    payload.payload = input.payload;
  }

  return payload;
}
