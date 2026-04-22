type MessageLike<IdValue extends string = string> = {
  _id: IdValue;
  createdAt: number;
};

type OpenClawEventPayloadInput = {
  type: string;
  threadId?: string;
  messageId?: string;
  actionId?: string;
  payload?: unknown;
};

export function normalizeOpenClawTitle(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || "Main";
}

export function sortOpenClawMessagesAscending<IdValue extends string, T extends MessageLike<IdValue>>(
  messages: T[],
): T[] {
  return [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    return left._id.localeCompare(right._id);
  });
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
