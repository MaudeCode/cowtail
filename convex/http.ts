import { Hono } from "hono";
import { cors } from "hono/cors";
import { type HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";

const app: HonoWithConvex<ActionCtx> = new Hono();

// CORS for dev
app.use("/api/*", cors());

// POST /api/alerts — write endpoint for Maude's alert sessions
app.post("/api/alerts", async (c) => {
  const body = await c.req.json();
  const ctx = c.env;

  const id = await ctx.runMutation(api.alerts.insert, {
    timestamp: body.timestamp ?? Date.now(),
    alertname: body.alertname,
    severity: body.severity,
    namespace: body.namespace,
    node: body.node,
    status: body.status,
    outcome: body.outcome,
    summary: body.summary,
    action: body.action,
    rootCause: body.rootCause,
    messaged: body.messaged ?? false,
    resolvedAt: body.resolvedAt,
  });

  return c.json({ ok: true, id });
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

export default new HttpRouterWithHono(app);
