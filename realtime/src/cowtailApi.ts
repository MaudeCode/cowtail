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

import type { AppSessionValidationResult, AppSessionVerificationResult } from "./auth";

type ConvexApiRefs = {
  authSessions: { verifySessionTokenHash: unknown; validateSessionById: unknown };
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
  validateAppSession(sessionId: string): Promise<AppSessionValidationResult>;
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
  private readonly serviceToken: string;

  constructor(convex: ConvexLike, serviceToken: string) {
    this.convex = convex;
    this.serviceToken = serviceToken;
  }

  static fromUrl(convexUrl: string, serviceToken: string): ConvexCowtailRealtimeApi {
    return new ConvexCowtailRealtimeApi(
      new ConvexHttpClient(convexUrl) as ConvexLike,
      serviceToken,
    );
  }

  async verifyAppSessionToken(token: string): Promise<AppSessionVerificationResult> {
    const result = await this.convex.mutation(convexApi.authSessions.verifySessionTokenHash, {
      serviceToken: this.serviceToken,
      tokenHash: await sha256Hex(token),
    });

    if (!result || typeof result !== "object") {
      return { ok: false };
    }

    const verification = result as {
      ok?: unknown;
      userId?: unknown;
      sessionId?: unknown;
      expiresAt?: unknown;
    };
    if (
      verification.ok !== true ||
      typeof verification.userId !== "string" ||
      typeof verification.sessionId !== "string" ||
      typeof verification.expiresAt !== "number"
    ) {
      return { ok: false };
    }

    return {
      ok: true,
      userId: verification.userId,
      sessionId: verification.sessionId,
      expiresAt: verification.expiresAt,
    };
  }

  async validateAppSession(sessionId: string): Promise<AppSessionValidationResult> {
    const result = await this.convex.query(convexApi.authSessions.validateSessionById, {
      serviceToken: this.serviceToken,
      sessionId: sessionId as never,
    });

    if (!result || typeof result !== "object") {
      return { ok: false };
    }

    const validation = result as { ok?: unknown; userId?: unknown; expiresAt?: unknown };
    if (
      validation.ok !== true ||
      typeof validation.userId !== "string" ||
      typeof validation.expiresAt !== "number"
    ) {
      return { ok: false };
    }

    return { ok: true, userId: validation.userId, expiresAt: validation.expiresAt };
  }

  async replayEvents(afterSequence?: OpenClawSequence): Promise<OpenClawEventEnvelope[]> {
    const args = addDefined(
      { limit: 100, serviceToken: this.serviceToken },
      "afterSequence",
      afterSequence,
    ) as OpenClawReplayQuery & { serviceToken: string };
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
              serviceToken: this.serviceToken,
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
    const args = addDefined(
      { serviceToken: this.serviceToken, text: command.text },
      "title",
      command.title,
    );
    const result = await this.convex.mutation(convexApi.openclaw.createPendingThreadFromIos, args);
    return await this.eventBySequence(getSequence(result));
  }

  async createIosReply(command: OpenClawIosReplyCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.createReplyFromIos, {
      serviceToken: this.serviceToken,
      threadId: command.threadId as never,
      text: command.text,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async submitIosAction(command: OpenClawIosActionCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.submitActionFromIos, {
      serviceToken: this.serviceToken,
      actionId: command.actionId as never,
      payload: command.payload,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async markThreadRead(command: OpenClawIosMarkThreadReadCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.markThreadRead, {
      serviceToken: this.serviceToken,
      threadId: command.threadId as never,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async bindThreadSession(command: OpenClawSessionBoundCommand): Promise<OpenClawEventEnvelope> {
    const result = await this.convex.mutation(convexApi.openclaw.bindThreadSession, {
      serviceToken: this.serviceToken,
      threadId: command.threadId as never,
      sessionKey: command.sessionKey,
    });
    return await this.eventBySequence(getSequence(result));
  }

  async recordActionResult(command: OpenClawActionResultCommand): Promise<OpenClawEventEnvelope> {
    const args = addDefined(
      {
        serviceToken: this.serviceToken,
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
        serviceToken: this.serviceToken,
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
