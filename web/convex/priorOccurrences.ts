import type { PriorOccurrence } from "@maudecode/cowtail-protocol";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { fixesForAlert } from "./fixes";
import { itemOutcome } from "./itemModel";

const PRIOR_OCCURRENCE_LIMIT = 3;

/**
 * Up to 3 earlier firings of an alert, newest first: the same Alertmanager fingerprint first,
 * then, while fewer than 3 match, the same alertname in the same namespace. An alert from the
 * same Alertmanager event is part of this firing, not an earlier one. Investigation claims and
 * item detail both read it.
 */
export async function findPriorOccurrences(
  ctx: QueryCtx,
  alert: Doc<"alerts">,
): Promise<PriorOccurrence[]> {
  const found = new Map<string, Doc<"alerts">>();
  const collect = async (candidates: AsyncIterable<Doc<"alerts">>) => {
    if (found.size >= PRIOR_OCCURRENCE_LIMIT) return;
    for await (const candidate of candidates) {
      const sameFiring =
        candidate._id === alert._id ||
        (alert.sourceEventId !== undefined && candidate.sourceEventId === alert.sourceEventId);
      if (!sameFiring) found.set(String(candidate._id), candidate);
      if (found.size >= PRIOR_OCCURRENCE_LIMIT) return;
    }
  };

  const fingerprint = alert.alertmanagerFingerprint;
  if (fingerprint) {
    await collect(
      ctx.db
        .query("alerts")
        .withIndex("by_fingerprint_timestamp", (q) =>
          q.eq("alertmanagerFingerprint", fingerprint).lt("timestamp", alert.timestamp),
        )
        .order("desc"),
    );
  }
  await collect(
    ctx.db
      .query("alerts")
      .withIndex("by_alertname_namespace_timestamp", (q) =>
        q
          .eq("alertname", alert.alertname)
          .eq("namespace", alert.namespace)
          .lt("timestamp", alert.timestamp),
      )
      .order("desc"),
  );

  const priors = [...found.values()].sort((a, b) => b.timestamp - a.timestamp);
  return await Promise.all(
    priors.map(async (prior) => {
      const rootCause = prior.rootCause?.trim() || undefined;
      const fixes = (await fixesForAlert(ctx, prior._id)).map(
        ({ description, rootCause, commit }) => ({ description, rootCause, commit }),
      );
      return {
        alertId: String(prior._id),
        firedAt: prior.timestamp,
        resolvedAt: prior.resolvedAt,
        outcome: itemOutcome({ context: {} }, prior),
        rootCause,
        summary: prior.summary,
        ownerDisposition: prior.ownerDisposition,
        // What a row shows: the cause, or what happened when none was recorded, and the
        // newest fix's commit.
        cause: rootCause ?? prior.summary,
        fixCommit: fixes.find((fix) => fix.commit)?.commit,
        fixes,
      };
    }),
  );
}

// Each alert's earlier firings, by alert ID.
export const forAlerts = internalQuery({
  args: { alertIds: v.array(v.id("alerts")) },
  handler: async (ctx, { alertIds }) => {
    const byAlert: Record<string, PriorOccurrence[]> = {};
    for (const alertId of alertIds) {
      const alert = await ctx.db.get(alertId);
      if (alert) byAlert[String(alertId)] = await findPriorOccurrences(ctx, alert);
    }
    return byAlert;
  },
});
