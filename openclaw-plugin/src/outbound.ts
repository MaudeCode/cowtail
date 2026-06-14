import { buildCowtailTarget, normalizeCowtailTarget } from "./session-keys.js";
import type { CowtailCommandResult, OpenClawMessageInput } from "./client.js";
import type { ResolvedCowtailAccount } from "./types.js";

type CowtailOutboundMessage = OpenClawMessageInput & { threadId: string };

type CowtailOutboundClient = {
  sendOpenClawMessage(command: CowtailOutboundMessage): Promise<CowtailCommandResult>;
};

export type CowtailOutboundResult = {
  channel: "cowtail";
  messageId: string;
  to: string;
};

function ensureNonBlankText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("Cowtail text must not be blank");
  }
  return text;
}

function resolveCowtailTarget(to: string): string {
  const normalizedTarget = normalizeCowtailTarget(to);
  if (!normalizedTarget) {
    throw new Error("Cowtail target must not be blank");
  }
  return normalizedTarget;
}

function resolveCowtailThreadId(params: {
  target: string;
  threadId?: string | null | undefined;
}): string {
  if (params.threadId != null) {
    const normalizedThreadId = normalizeCowtailTarget(params.threadId);
    if (!normalizedThreadId) {
      throw new Error("Cowtail threadId must not be blank");
    }
    return normalizedThreadId;
  }

  return params.target;
}

export async function sendCowtailText(params: {
  account: Pick<ResolvedCowtailAccount, "agentId">;
  client: CowtailOutboundClient;
  to: string;
  threadId?: string | null;
  text: string;
}): Promise<CowtailOutboundResult> {
  const { client, to } = params;
  const text = ensureNonBlankText(params.text);
  const target = resolveCowtailTarget(to);
  const threadId = resolveCowtailThreadId({ target, threadId: params.threadId });
  const sessionKey = buildCowtailTarget(target);

  const result = await client.sendOpenClawMessage({
    type: "openclaw_message",
    sessionKey,
    threadId,
    threadHint: target,
    text,
    links: [],
    actions: [],
  });
  const messageId = result.payload?.messageId;
  if (typeof messageId !== "string" || messageId.trim() === "") {
    throw new Error("Cowtail did not acknowledge a durable message id");
  }

  const acknowledgedThreadId =
    typeof result.payload?.threadId === "string"
      ? normalizeCowtailTarget(result.payload.threadId)
      : "";
  if (acknowledgedThreadId !== threadId) {
    throw new Error("Cowtail did not acknowledge a durable message in the intended thread");
  }

  return {
    channel: "cowtail",
    messageId,
    to: buildCowtailTarget(target),
  };
}
