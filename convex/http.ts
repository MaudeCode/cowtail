import { Hono } from "hono";
import { cors } from "hono/cors";
import { type HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";

const app: HonoWithConvex<ActionCtx> = new Hono();

app.use("/api/*", cors());

// POST /api/alerts — write endpoint
app.post("/api/alerts", async (c) => {
  const body = await c.req.json();
  const ctx = c.env;
  // Strip null/undefined values — Convex optional fields must be omitted, not null
  const args: Record<string, unknown> = {
    timestamp: body.timestamp ?? Date.now(),
    alertname: body.alertname,
    severity: body.severity,
    namespace: body.namespace,
    status: body.status,
    outcome: body.outcome,
    summary: body.summary,
    action: body.action,
    messaged: body.messaged ?? false,
  };
  if (body.node) args.node = body.node;
  if (body.rootCause) args.rootCause = body.rootCause;
  if (body.resolvedAt) args.resolvedAt = body.resolvedAt;
  const id = await ctx.runMutation(api.alerts.insert, args as any);
  return c.json({ ok: true, id });
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

  // Format date range
  const fmtDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  };
  const year = new Date(toParam).toLocaleDateString("en-US", { year: "numeric", timeZone: "America/New_York" });
  const dateRange = fmtDate(fromParam) === fmtDate(toParam)
    ? `${fmtDate(fromParam)}, ${year}`
    : `${fmtDate(fromParam)}–${fmtDate(toParam)}, ${year}`;

  const digestUrl = `https://cowtail.example.com/digest?from=${fromParam}&to=${toParam}`;

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
        <td width="20%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#E8E8EA;">${stats.total}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Total</div></td>
        <td width="20%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#2D9B52;">${stats.fixed}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Fixed</div></td>
        <td width="20%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#3A7BD5;">${stats.selfResolved}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">S-Resolved</div></td>
        <td width="20%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#5A5A64;">${stats.noise}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Noise</div></td>
        <td width="20%" style="background:#161618;padding:14px 8px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#D4880A;">${stats.escalated}</div><div style="font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#6E6E76;margin-top:4px;">Escalated</div></td>
      </tr>
    </table>
  </td></tr>
  ${alertSections}
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
