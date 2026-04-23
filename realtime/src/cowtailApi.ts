import { ConvexHttpClient } from "convex/browser";
import type {
  OpenClawActionResultCommand,
  OpenClawEventEnvelope,
  OpenClawIosActionCommand,
  OpenClawIosMarkThreadReadCommand,
  OpenClawIosNewThreadCommand,
  OpenClawIosReplyCommand,
  OpenClawPluginMessageCommand,
  OpenClawReplayQuery,
  OpenClawSequence,
  OpenClawSessionBoundCommand,
} from "@maudecode/cowtail-protocol";

import type { AppSessionVerificationResult } from "./auth";

type ConvexApiRefs = {
  authSessions: { verifySessionTokenHash: unknown };
  openclaw: {
    replayEvents: unknown;
    createThreadFromOpenClaw: unknown;
    createPendingThreadFromIos: unknown;
    createReplyFromIos: unknown;
    submitActionFromIos: unknown;
    markThreadRead: unknown;
    bindThreadSession: unknown;
    recordActionResultFromOpenClaw: unknown;
  };
};

const generatedConvexApiModule = "../../web/convex/_generated/api.js";
const { api: convexApi } = (await import(generatedConvexApiModule)) as { api: ConvexApiRefs };

export type ConvexLike = {
  query(reference: unknown, args: unknown): Promise<unknown>;
  mutation(reference: unknown, args: unknown): Promise<unknown>;
};

export interface CowtailRealtimeApi {
  verifyAppSessionToken(token: string): Promise<AppSessionVerificationResult>;
  replayEvents(afterSequence?: OpenClawSequence): Promise<OpenClawEventEnvelope[]>;
  createOpenClawMessage(command: OpenClawPluginMessageCommand): Promise<OpenClawEventEnvelope>;
  createIosThread(command: OpenClawIosNewThreadCommand): Promise<OpenClawEventEnvelope>;
  createIosReply(command: OpenClawIosReplyCommand): Promise<OpenClawEventEnvelope>;
  submitIosAction(command: OpenClawIosActionCommand): Promise<OpenClawEventEnvelope>;
  markThreadRead(command: OpenClawIosMarkThreadReadCommand): Promise<OpenClawEventEnvelope>;
  bindThreadSession(command: OpenClawSessionBoundCommand): Promise<OpenClawEventEnvelope>;
  recordActionResult(command: OpenClawActionResultCommand): Promise<OpenClawEventEnvelope>;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getSequence(value: unknown): OpenClawSequence {
  if (!value || typeof value !== "object") {
    throw new Error("Convex mutation result did not include a sequence");
  }

  const sequence = (value as { sequence?: unknown }).sequence;
  if (typeof sequence !== "number") {
    throw new Error("Convex mutation result did not include a sequence");
  }

  return sequence;
}

export function getFirstEvent(value: unknown, sequence?: OpenClawSequence): OpenClawEventEnvelope {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      sequence === undefined
        ? "Convex replay query did not return an event"
        : `Convex replay query did not return an event for mutation sequence ${sequence}`,
    );
  }

  return value[0] as OpenClawEventEnvelope;
}

function addDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (value !== undefined) {
    target[key] = value;
  }

  return target;
}

export class ConvexCowtailRealtimeApi implements CowtailRealtimeApi {
  private readonly convex: ConvexLike;

  constructor(convex: ConvexLike) {
    this.convex = convex;
  }

  static fromUrl(convexUrl: string): ConvexCowtailRealtimeApi {
    return new ConvexCowtailRealtimeApi(new ConvexHttpClient(convexUrl) as ConvexLike);
  }

  async verifyAppSessionToken(token: string): Promise<AppSessionVerificationResult> {
    const result = await this.convex.mutation(convexApi.authSessions.verifySessionTokenHash, {
      tokenHash: await sha256Hex(token),
    });

    if (!result || typeof result !== "object") {
      return { ok: false };
    }

    const verification = result as { ok?: unknown; userId?: unknown };
    if (verification.ok !== true || typeof verification.userId !== "string") {
      return { ok: false };
    }

    return { ok: true, userId: verification.userId };
  }

  async replayEvents(afterSequence?: OpenClawSequence): Promise<OpenClawEventEnvelope[]> {
    const args = addDefined({ limit: 100 }, "afterSequence", afterSequence) as OpenClawReplayQuery;
    return (await this.convex.query(
      convexApi.openclaw.replayEvents,
      args,
    )) as OpenClawEventEnvelope[];
  }

  async createOpenClawMessage(
    command: OpenClawPluginMessageCommand,
  ): Promise<OpenClawEventEnvelope> {
    const args = addDefined(
      addDefined(
        addDefined(
          addDefined(
            {
              sessionKey: command.sessionKey,
              text: command.text,
            },
            "title",
            command.title,
          ),
          "authorLabel",
          command.authorLabel,
        ),
        "links",
        command.links,
      ),
      "actions",
      command.actions,
    );
    const result = await this.convex.mutation(convexApi.openclaw.createThreadFromOpenClaw, args);
    return await this.eventBySequence(getSequence(result));
  }

  async createIosThread(command: OpenClawIosNewThreadCommand): Promise<OpenClawEventEnvelope> {
    const args = addDefined({ text: command.text }, "title", command.title);
    const result = await this.convex.mutation(convexApi.openclaw.createPendingThreadFromIos, args);
    return await this.eventBySequence(getSequence(result));
  }

  async createIosReply(command: OpenClawIosReplyCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.createReplyFromIos, {
      threadId: command.threadId as never,
      text: command.text,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async submitIosAction(command: OpenClawIosActionCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.submitActionFromIos, {
      actionId: command.actionId as never,
      payload: command.payload,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async markThreadRead(command: OpenClawIosMarkThreadReadCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.markThreadRead, {
      threadId: command.threadId as never,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async bindThreadSession(command: OpenClawSessionBoundCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.bindThreadSession, {
      threadId: command.threadId as never,
      sessionKey: command.sessionKey,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async recordActionResult(command: OpenClawActionResultCommand): Promise<OpenClawEventEnvelope> {
    const args = addDefined(
      {
        actionId: command.actionId as never,
        state: command.state,
      },
      "resultMetadata",
      command.resultMetadata,
    );
    const result = await this.convex.mutation(
      convexApi.openclaw.recordActionResultFromOpenClaw,
      args,
    );
    return await this.eventBySequence(getSequence(result));
  }

  private async eventBySequence(sequence: OpenClawSequence): Promise<OpenClawEventEnvelope> {
    const event = getFirstEvent(
      await this.convex.query(convexApi.openclaw.replayEvents, {
        afterSequence: sequence - 1,
        limit: 1,
      }),
      sequence,
    );

    if (event.sequence !== sequence) {
      throw new Error(
        `Convex replay query returned sequence ${event.sequence} for mutation sequence ${sequence}`,
      );
    }

    return event;
  }
}
