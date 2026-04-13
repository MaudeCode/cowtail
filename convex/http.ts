import { Hono } from "hono";
import { cors } from "hono/cors";
import { type HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import {
  alertCreateRequestSchema,
  createResponseSchema,
  fixCreateRequestSchema,
  pushResultSchema,
  pushSendRequestSchema,
  pushTestRequestSchema,
  subsListResponseSchema,
} from "@maudecode/cowtail-protocol";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";

const app: HonoWithConvex<ActionCtx> = new Hono();

app.use("/api/*", cors());

function jsonError(message: string, status = 400, details?: Record<string, unknown>) {
  return Response.json({ ok: false, error: message, ...(details ?? {}) }, { status });
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractAlertId(value: Record<string, unknown>): string | undefined {
  return nonEmptyString(value.alertId)
    ?? nonEmptyString(value.alertID)
    ?? nonEmptyString(value.alert_id);
}

function buildAlertURL(alertId: string): string {
  const origin = nonEmptyString(process.env.COWTAIL_WEB_ORIGIN) ?? "https://cowtail.thezoo.house";
  return `${origin.replace(/\/+$/, "")}/alerts/${encodeURIComponent(alertId)}`;
}

function enrichPushData(
  data: Record<string, unknown> | undefined,
  alertId: string | undefined
): Record<string, unknown> | undefined {
  const enriched = data ? { ...data } : {};
  const resolvedAlertId = alertId ?? extractAlertId(enriched);

  if (!resolvedAlertId) {
    return Object.keys(enriched).length > 0 ? enriched : undefined;
  }

  enriched.alertId = resolvedAlertId;

  if (
    !nonEmptyString(enriched.url)
    && !nonEmptyString(enriched.link)
    && !nonEmptyString(enriched.deepLinkURL)
    && !nonEmptyString(enriched.deepLinkUrl)
    && !nonEmptyString(enriched.deep_link_url)
  ) {
    enriched.url = buildAlertURL(resolvedAlertId);
  }

  return enriched;
}

function requireServiceAuth(c: { req: { header(name: string): string | undefined } }) {
  const expected = process.env.PUSH_API_BEARER_TOKEN?.trim();
  if (!expected) {
    return jsonError("Push API bearer token is not configured", 500);
  }

  const authorization = c.req.header("authorization")?.trim();
  if (authorization !== `Bearer ${expected}`) {
    return jsonError("Unauthorized", 401);
  }

  return null;
}

function formatIssues(issues: Array<{ message: string; path?: ReadonlyArray<PropertyKey> }>) {
  return issues
    .map((issue) => {
      const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

// POST /api/alerts — write endpoint
app.post("/api/alerts", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = alertCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues));
  }

  const ctx = c.env;
  // Strip null/undefined values — Convex optional fields must be omitted, not null
  const args: Record<string, unknown> = {
    timestamp: parsed.data.timestamp ?? Date.now(),
    alertname: parsed.data.alertname,
    severity: parsed.data.severity,
    namespace: parsed.data.namespace,
    status: parsed.data.status,
    outcome: parsed.data.outcome,
    summary: parsed.data.summary,
    action: parsed.data.action,
    messaged: parsed.data.messaged ?? false,
  };
  if (parsed.data.node) args.node = parsed.data.node;
  if (parsed.data.rootCause) args.rootCause = parsed.data.rootCause;
  if (parsed.data.resolvedAt) args.resolvedAt = parsed.data.resolvedAt;
  const id = await ctx.runMutation(api.alerts.insert, args as any);
  return c.json(createResponseSchema.parse({ ok: true, id }));
});

// DELETE /api/alerts/:id — delete a single alert
app.delete("/api/alerts/:id", async (c) => {
  const ctx = c.env;
  const id = c.req.param("id");
  try {
    await ctx.runMutation(api.alerts.deleteById, { id: id as any });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 400);
  }
});

// POST /api/fixes — write endpoint
app.post("/api/fixes", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = fixCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues));
  }

  const ctx = c.env;
  const args: Record<string, unknown> = {
    timestamp: parsed.data.timestamp ?? Date.now(),
    alertIds: parsed.data.alertIds,
    description: parsed.data.description,
    rootCause: parsed.data.rootCause,
    scope: parsed.data.scope,
  };
  if (parsed.data.commit) args.commit = parsed.data.commit;
  const id = await ctx.runMutation(api.fixes.insert, args as any);
  return c.json(createResponseSchema.parse({ ok: true, id }));
});

// DELETE /api/fixes/:id — delete a single fix
app.delete("/api/fixes/:id", async (c) => {
  const ctx = c.env;
  const id = c.req.param("id");
  try {
    await ctx.runMutation(api.fixes.deleteById, { id: id as any });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 400);
  }
});

// POST /api/alerts/webhook — Alertmanager-native webhook receiver
// Accepts Alertmanager's payload format and writes alerts directly to Convex.
// Used for known-noise alerts that don't need AI investigation.
app.post("/api/alerts/webhook", async (c) => {
  const body = await c.req.json();
  const ctx = c.env;

  // Alertmanager sends { status, alerts: [...] }
  const alerts = body.alerts;
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return c.json({ ok: false, error: "No alerts in payload" }, 400);
  }

  const ids: string[] = [];
  for (const alert of alerts) {
    const labels = alert.labels ?? {};
    const annotations = alert.annotations ?? {};
    const status = alert.status ?? "firing";

    const args: Record<string, unknown> = {
      timestamp: alert.startsAt ? new Date(alert.startsAt).getTime() : Date.now(),
      alertname: labels.alertname ?? "unknown",
      severity: labels.severity ?? "warning",
      namespace: labels.namespace ?? "unknown",
      status,
      outcome: "noise",
      summary: annotations.description || annotations.summary || `${labels.alertname} ${status}`,
      action: "Auto-logged via direct webhook (no AI investigation)",
      messaged: false,
    };
    if (labels.node) args.node = labels.node;
    if (labels.instance) args.node = labels.instance;
    if (status === "resolved" && alert.endsAt) {
      args.resolvedAt = new Date(alert.endsAt).getTime();
    }

    const id = await ctx.runMutation(api.alerts.insert, args as any);
    ids.push(id);
  }

  return c.json({ ok: true, ids, count: ids.length });
});

// POST /api/push/register — register or refresh an iOS device token
app.post("/api/push/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  if (!body.userId || !body.deviceToken) {
    return jsonError("userId and deviceToken are required");
  }

  const ctx = c.env;
  const result = await ctx.runMutation(api.push.upsertDeviceRegistration, {
    userId: String(body.userId).trim(),
    deviceToken: String(body.deviceToken).trim(),
    platform: body.platform ? String(body.platform).trim() : "ios",
    environment: body.environment ? String(body.environment).trim() : (process.env.APNS_ENV?.trim() || "development"),
    enabled: true,
    deviceName: body.deviceName ? String(body.deviceName).trim() : undefined,
    lastSeenAt: Date.now(),
  });

  return c.json({ ok: true, ...result });
});

// POST /api/push/unregister — disable a device token without deleting history
app.post("/api/push/unregister", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  if (!body.deviceToken) {
    return jsonError("deviceToken is required");
  }

  const ctx = c.env;
  const result = await ctx.runMutation(api.push.disableDeviceRegistrationByToken, {
    deviceToken: String(body.deviceToken).trim(),
  });

  return c.json(result);
});

async function sendPushToUser(ctx: ActionCtx, args: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  const devices = await ctx.runQuery(api.push.listEnabledDevicesForUser, { userId: args.userId });

  if (devices.length === 0) {
    return {
      ok: true,
      userId: args.userId,
      sent: 0,
      failed: 0,
      results: [] as Array<Record<string, unknown>>,
    };
  }

  const results: Array<Record<string, unknown>> = [];
  let sent = 0;
  let failed = 0;

  for (const device of devices) {
    const result = await ctx.runAction(internal.pushActions.sendApnsToDevice, {
      deviceToken: device.deviceToken,
      title: args.title,
      body: args.body,
      data: args.data,
    });

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (result.reason && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(String(result.reason))) {
        await ctx.runMutation(api.push.disableDeviceRegistrationByToken, {
          deviceToken: device.deviceToken,
        });
      }
    }

    results.push({
      deviceToken: device.deviceToken.length <= 12
        ? device.deviceToken
        : `${device.deviceToken.slice(0, 6)}…${device.deviceToken.slice(-6)}`,
      ...result,
    });
  }

  return {
    ok: failed === 0,
    userId: args.userId,
    sent,
    failed,
    results,
  };
}

// POST /api/push/send — authenticated push send endpoint for Maude
app.post("/api/push/send", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = pushSendRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues));
  }

  const data = enrichPushData(parsed.data.data, extractAlertId(body));

  const result = await sendPushToUser(c.env, {
    userId: parsed.data.userId,
    title: parsed.data.title,
    body: parsed.data.body,
    data,
  });

  return c.json(pushResultSchema.parse(result));
});

// POST /api/push/test — authenticated helper for test sends
app.post("/api/push/test", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = pushTestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues));
  }

  const data = enrichPushData(parsed.data.data, extractAlertId(body));

  const result = await sendPushToUser(c.env, {
    userId: parsed.data.userId,
    title: parsed.data.title ?? "Cowtail test notification",
    body: parsed.data.body ?? "Push delivery from Cowtail is working.",
    data: {
      test: true,
      ...(data ?? {}),
    },
  });

  return c.json(pushResultSchema.parse(result));
});

// GET /api/subs — list current enabled Apple subs with enabled device counts
app.get("/api/subs", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const subs = await c.env.runQuery(api.push.listCurrentSubs, {});
  return c.json(subsListResponseSchema.parse({
    ok: true,
    count: subs.length,
    subs,
  }));
});

// GET /api/health — placeholder for Prometheus proxy
app.get("/api/health", async (c) => {
  return c.json({
    nodes: [
      { name: "k8s-chronos", status: "Ready", cpu: 11, memory: 33 },
      { name: "k8s-coeus", status: "Ready", cpu: 12, memory: 33 },
      { name: "k8s-oceanus", status: "Ready", cpu: 9, memory: 33 },
      { name: "k8s-rhea", status: "Ready", cpu: 2, memory: 19 },
      { name: "k8s-tethys", status: "Ready", cpu: 12, memory: 42 },
    ],
    cephStatus: "HEALTH_OK",
    cephMessage: "All PGs active+clean",
    storageUsed: 1.7,
    storageTotal: 3.7,
    storageUnit: "TiB",
  });
});

// GET /api/digest-html — pre-rendered email HTML for the digest
app.get("/api/digest-html", async (c) => {
  const ctx = c.env;
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  if (!fromParam || !toParam) {
    return c.text("Missing from/to params", 400);
  }

  const from = new Date(fromParam).getTime();
  const to = new Date(toParam + "T23:59:59Z").getTime();

  const alerts = await ctx.runQuery(api.alerts.getByTimeRange, { from, to });
  const fixes = await ctx.runQuery(api.fixes.getByTimeRange, { from, to });

  // Format date range — parse as noon UTC to avoid timezone date shifts
  const fmtDate = (d: string) => {
    const date = new Date(d + "T12:00:00Z");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  };
  const year = new Date(toParam + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", timeZone: "America/New_York" });
  const dateRange = fmtDate(fromParam) === fmtDate(toParam)
    ? `${fmtDate(fromParam)}, ${year}`
    : `${fmtDate(fromParam)}–${fmtDate(toParam)}, ${year}`;

  const siteOrigin = process.env.SITE_ORIGIN ?? "https://cowtail.example.com";
  const digestUrl = `${siteOrigin}/digest?from=${fromParam}&to=${toParam}`;

  // Stats
  const stats = {
    total: alerts.length,
    fixed: alerts.filter((a: any) => a.outcome === "fixed").length,
    selfResolved: alerts.filter((a: any) => a.outcome === "self-resolved").length,
    noise: alerts.filter((a: any) => a.outcome === "noise").length,
    escalated: alerts.filter((a: any) => a.outcome === "escalated").length,
  };

  // Group by outcome
  const groups: Record<string, any[]> = {};
  for (const a of alerts) {
    (groups[a.outcome] ??= []).push(a);
  }

  const outcomeConfig: Record<string, { label: string; bg: string; color: string }> = {
    escalated: { label: "Escalated", bg: "#D4880A", color: "#D4880A" },
    fixed: { label: "Fixed", bg: "#2D9B52", color: "#2D9B52" },
    "self-resolved": { label: "Self Resolved", bg: "#3A7BD5", color: "#3A7BD5" },
    noise: { label: "Noise", bg: "#5A5A64", color: "#5A5A64" },
  };

  const severityColor: Record<string, string> = {
    critical: "#B8242C",
    warning: "#D4880A",
    info: "#6E6E76",
  };

  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "America/New_York" }) + " " +
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
  };

  // Build alert sections
  const outcomeOrder = ["escalated", "fixed", "self-resolved", "noise"];
  let alertSections = "";

  for (const outcome of outcomeOrder) {
    const items = groups[outcome];
    if (!items?.length) continue;
    const oc = outcomeConfig[outcome];

    let rows = "";
    const sorted = items.sort((a: any, b: any) => a.timestamp - b.timestamp);
    for (const a of sorted) {
      const sevColor = severityColor[a.severity] ?? "#6E6E76";
      const rootCauseHtml = a.rootCause
        ? `<div style="margin-top:6px;"><span style="font-family:'DM Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;">Root cause: </span><span style="font-family:'Space Grotesk',sans-serif;font-size:13px;color:#9A9AA2;">${a.rootCause}</span></div>`
        : "";
      const nodeHtml = a.node ? `<span style="font-weight:400;color:#6E6E76;margin-left:8px;font-size:13px;">${a.node}</span>` : "";

      rows += `<tr><td style="padding:12px 0 12px 12px;border-left:3px solid #3A3A3F;">
        <div style="margin-bottom:4px;">
          <span style="display:inline-block;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;padding:2px 6px;color:#fff;background:${oc.bg};">${oc.label}</span>
          <span style="font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;color:${sevColor};margin-left:8px;">${a.severity}</span>
          <span style="font-family:'DM Mono',monospace;font-size:10px;color:#6E6E76;margin-left:8px;">${fmtTs(a.timestamp)}</span>
        </div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;color:#E8E8EA;margin-bottom:4px;word-break:break-word;">${a.alertname}${nodeHtml}</div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:13px;color:#9A9AA2;line-height:1.5;">${a.summary}</div>
        ${rootCauseHtml}
        <div style="margin-top:4px;"><span style="font-family:'DM Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;">Action: </span><span style="font-family:'Space Grotesk',sans-serif;font-size:13px;color:#9A9AA2;">${a.action}</span></div>
      </td></tr>`;
    }

    alertSections += `<tr><td style="padding:0 0 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-family:'DM Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;border-bottom:2px solid #3A3A3F;padding-bottom:8px;margin-bottom:16px;">
          ${oc.label} <span style="color:${oc.color};">(${items.length})</span>
        </td></tr>
        ${rows}
      </table>
    </td></tr>`;
  }

  // Build fixes section
  const scopeConfig: Record<string, { label: string; bg: string }> = {
    reactive: { label: "Reactive", bg: "#2D9B52" },
    weekly: { label: "Weekly", bg: "#3A7BD5" },
    monthly: { label: "Monthly", bg: "#8b5cf6" },
  };

  let fixesSections = "";
  if (fixes.length > 0) {
    let fixRows = "";
    const sortedFixes = [...fixes].sort((a: any, b: any) => a.timestamp - b.timestamp);
    for (const f of sortedFixes) {
      const sc = scopeConfig[f.scope] ?? { label: f.scope, bg: "#6E6E76" };
      const commitHtml = f.commit
        ? `<div style="margin-top:4px;"><span style="font-family:'DM Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;">Commit: </span><span style="font-family:'DM Mono',monospace;font-size:13px;color:#9A9AA2;">${f.commit.slice(0, 7)}</span></div>`
        : "";

      fixRows += `<tr><td style="padding:12px 0 12px 12px;border-left:3px solid #3A3A3F;">
        <div style="margin-bottom:4px;">
          <span style="display:inline-block;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;padding:2px 6px;color:#fff;background:${sc.bg};">${sc.label}</span>
          <span style="font-family:'DM Mono',monospace;font-size:10px;color:#6E6E76;margin-left:8px;">${fmtTs(f.timestamp)}</span>
        </div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;color:#E8E8EA;margin-bottom:4px;word-break:break-word;">${f.description}</div>
        <div style="margin-top:4px;"><span style="font-family:'DM Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;">Root cause: </span><span style="font-family:'Space Grotesk',sans-serif;font-size:13px;color:#9A9AA2;">${f.rootCause}</span></div>
        ${commitHtml}
      </td></tr>`;
    }

    fixesSections = `<tr><td style="padding:0 0 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-family:'DM Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;border-bottom:2px solid #3A3A3F;padding-bottom:8px;margin-bottom:16px;">
          Fixes Applied <span style="color:#3A7BD5;">(${fixes.length})</span>
        </td></tr>
        ${fixRows}
      </table>
    </td></tr>`;
  }

  // Build full HTML
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0E0E10;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;color:#E8E8EA;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0E0E10;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="padding:0 0 8px;">
    <span style="font-size:28px;font-weight:700;text-transform:uppercase;letter-spacing:-0.03em;color:#E8E8EA;">Cow</span><span style="font-size:28px;font-weight:700;text-transform:uppercase;letter-spacing:-0.03em;color:#B8242C;">tail</span>
    <span style="font-size:14px;color:#6E6E76;margin-left:10px;">Digest</span>
  </td></tr>
  <tr><td style="font-family:'DM Mono',monospace;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;padding:0 0 20px;">${dateRange}</td></tr>
  <tr><td style="padding:0 0 24px;"><a href="${digestUrl}" style="font-family:'DM Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#B8242C;text-decoration:none;border:1px solid #3A3A3F;padding:6px 14px;display:inline-block;">View in browser →</a></td></tr>
  <tr><td style="padding:0 0 24px;">
    <table width="100%" cellpadding="0" cellspacing="1" style="background:#3A3A3F;">
      <tr>
        <td width="16%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#E8E8EA;">${stats.total}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Total</div></td>
        <td width="16%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#2D9B52;">${stats.fixed}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Fixed</div></td>
        <td width="16%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#3A7BD5;">${stats.selfResolved}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Self-Res</div></td>
        <td width="16%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#5A5A64;">${stats.noise}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Noise</div></td>
        <td width="16%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#D4880A;">${stats.escalated}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Escalated</div></td>
        <td width="16%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#3A7BD5;">${fixes.length}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Fixes</div></td>
      </tr>
    </table>
  </td></tr>
  ${alertSections}
  ${fixesSections}
  <tr><td style="padding:24px 0 0;border-top:1px solid #3A3A3F;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:'DM Mono',monospace;font-size:10px;color:#6E6E76;text-transform:uppercase;letter-spacing:0.8px;">Maude 🐄</td>
      <td style="text-align:right;"><a href="${digestUrl}" style="font-family:'DM Mono',monospace;font-size:10px;color:#B8242C;text-decoration:none;text-transform:uppercase;letter-spacing:0.8px;">View in browser →</a></td>
    </tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return c.html(html);
});

export default new HttpRouterWithHono(app);
