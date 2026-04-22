import type { OpenClawEventType } from "@maudecode/cowtail-protocol";

type MessageLike<IdValue extends string = string> = {
  _id: IdValue;
  createdAt: number;
};

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
