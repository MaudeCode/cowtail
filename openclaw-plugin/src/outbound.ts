import { buildCowtailTarget, normalizeCowtailTarget } from "./session-keys.js";
import type { CowtailCommandResult } from "./client.js";
import type { ResolvedCowtailAccount } from "./types.js";

type CowtailOutboundClient = {
  sendOpenClawMessage(command: {
    type: "openclaw_message";
    sessionKey: string;
    threadId?: string;
    threadHint?: string;
    text: string;
    links: [];
    actions: [];
  }): Promise<CowtailCommandResult>;
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

export async function sendCowtailText(params: {
  account: Pick<ResolvedCowtailAccount, "agentId">;
  client: CowtailOutboundClient;
  to: string;
  text: string;
}): Promise<CowtailOutboundResult> {
  const { client, to } = params;
  const text = ensureNonBlankText(params.text);
  const target = resolveCowtailTarget(to);
  const sessionKey = buildCowtailTarget(target);

  const result = await client.sendOpenClawMessage({
    type: "openclaw_message",
    sessionKey,
    threadHint: target,
    text,
    links: [],
    actions: [],
  });
  const messageId = result.payload?.messageId;
  if (typeof messageId !== "string" || messageId.trim() === "") {
    throw new Error("Cowtail did not acknowledge a durable message id");
  }

  return {
    channel: "cowtail",
    messageId,
    to: buildCowtailTarget(target),
  };
}
