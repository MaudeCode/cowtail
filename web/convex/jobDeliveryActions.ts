import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";

const DELIVERY_BATCH_SIZE = 5;

type HermesJobNotification = {
  type: "cowtail.alert_job_available";
  jobId: string;
  alertId: string;
  fingerprint: string;
  alertname: string;
  severity: string;
  status: string;
  createdAt: number;
};

type DeliveryResult = {
  delivered: boolean;
  skipped?: boolean;
  error?: string;
  statusCode?: number;
};

type PendingDelivery = {
  _id: Id<"jobDeliveries">;
};

type RetrySummary = {
  attempted: number;
  delivered: number;
  failed: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function buildHermesJobNotification(
  job: {
    _id: string;
    alertId: string;
    fingerprint: string;
    status: string;
    createdAt: number;
  },
  alert: { alertname: string; severity: string },
): HermesJobNotification {
  return {
    type: "cowtail.alert_job_available",
    jobId: job._id,
    alertId: job.alertId,
    fingerprint: job.fingerprint,
    alertname: alert.alertname,
    severity: alert.severity,
    status: job.status,
    createdAt: job.createdAt,
  };
}

export function isHermesSchedulingAcknowledged(
  statusCode: number,
  body: unknown,
  deliveryId: string,
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const acknowledgement = body as Record<string, unknown>;
  const accepted = statusCode === 202 && acknowledgement.status === "accepted";
  const duplicate = statusCode === 200 && acknowledgement.status === "duplicate";
  return (accepted || duplicate) && acknowledgement.delivery_id === deliveryId;
}

async function recordAttempt(
  ctx: ActionCtx,
  deliveryId: Id<"jobDeliveries">,
  ok: boolean,
  error?: string,
  statusCode?: number,
): Promise<DeliveryResult> {
  await ctx.runMutation((internal as any).jobDeliveries.recordAttempt, {
    id: deliveryId,
    ok,
    now: Date.now(),
    statusCode,
    error,
  });

  return { delivered: ok, error, statusCode };
}

async function attemptHermesJobDelivery(
  ctx: ActionCtx,
  deliveryId: Id<"jobDeliveries">,
): Promise<DeliveryResult> {
  const delivery = await ctx.runQuery((api as any).jobDeliveries.getById, { id: deliveryId });
  if (!delivery || delivery.status !== "pending") {
    return { delivered: false, skipped: true, error: "Delivery is not pending" };
  }

  const job = await ctx.runQuery((api as any).investigationJobs.getById, {
    id: delivery.jobId,
  });
  if (!job) {
    return await recordAttempt(ctx, delivery._id, false, "Investigation job not found");
  }

  if (job.status !== "queued") {
    const result = await recordAttempt(ctx, delivery._id, true, undefined, 204);
    return { ...result, skipped: true };
  }

  const alert = await ctx.runQuery((api as any).alerts.getById, { id: job.alertId });
  if (!alert) {
    return await recordAttempt(ctx, delivery._id, false, "Alert for investigation job not found");
  }

  let webhookUrl: string;
  let webhookToken: string;
  try {
    webhookUrl = requiredEnv("COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL");
    webhookToken = requiredEnv("COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN");
  } catch (error) {
    return await recordAttempt(
      ctx,
      delivery._id,
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${webhookToken}`,
        "content-type": "application/json",
        "x-request-id": String(delivery._id),
      },
      body: JSON.stringify(buildHermesJobNotification(job, alert)),
      signal: AbortSignal.timeout(2_500),
    });

    const acknowledgement = await response.json().catch(() => null);
    const accepted = isHermesSchedulingAcknowledged(
      response.status,
      acknowledgement,
      String(delivery._id),
    );

    return await recordAttempt(
      ctx,
      delivery._id,
      accepted,
      accepted
        ? undefined
        : response.ok
          ? "Hermes webhook did not acknowledge scheduling"
          : `Hermes webhook returned HTTP ${response.status}`,
      response.status,
    );
  } catch (error) {
    return await recordAttempt(
      ctx,
      delivery._id,
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const deliverOne = internalAction({
  args: { deliveryId: v.id("jobDeliveries") },
  handler: async (ctx, args) => await attemptHermesJobDelivery(ctx, args.deliveryId),
});

export const retryDue = internalAction({
  args: {},
  handler: async (ctx): Promise<RetrySummary> => {
    const deliveries: PendingDelivery[] = await ctx.runQuery(
      (api as any).jobDeliveries.getPending,
      {
        now: Date.now(),
        limit: DELIVERY_BATCH_SIZE,
      },
    );
    const results: DeliveryResult[] = [];

    for (const delivery of deliveries) {
      results.push(await attemptHermesJobDelivery(ctx, delivery._id));
    }

    return {
      attempted: deliveries.length,
      delivered: results.filter((result) => result.delivered).length,
      failed: results.filter((result) => !result.delivered && !result.skipped).length,
    };
  },
});
