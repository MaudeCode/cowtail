import { Hono } from "hono";
import { ConvexError } from "convex/values";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { type HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import {
  authLogoutResponseSchema,
  authOidcHandoffRequestSchema,
  authOidcHandoffResponseSchema,
  authProvidersResponseSchema,
  authSessionCreateRequestSchema,
  authSessionCreateResponseSchema,
  alertGetResponseSchema,
  alertHumanActionRequestSchema,
  alertHumanActionResponseSchema,
  alertListQuerySchema,
  alertListResponseSchema,
  alertOutcomeSchema,
  alertRecordSchema,
  alertCreateRequestSchema,
  createResponseSchema,
  fixGetResponseSchema,
  fixListQuerySchema,
  fixListResponseSchema,
  fixCreateRequestSchema,
  healthResponseSchema,
  hermesHookPayloadSchema,
  hermesResponseClaimRequestSchema,
  hermesResponseClaimResponseSchema,
  hermesResponseCompleteRequestSchema,
  hermesResponseFailRequestSchema,
  hermesSnapshotSchema,
  hermesStatusResponseSchema,
  investigationEvidenceSchema,
  itemActionQuerySchema,
  itemActionRequestSchema,
  itemCreateRequestSchema,
  snoozeOptionsQuerySchema,
  snoozeOptionsResponseSchema,
  itemCreateResponseSchema,
  itemEventAppendRequestSchema,
  itemGetResponseSchema,
  itemInboxResponseSchema,
  itemSourcesResponseSchema,
  itemListQuerySchema,
  itemListResponseSchema,
  itemResponseSchema,
  itemStatsQuerySchema,
  itemStatsResponseSchema,
  notificationPreferencesResponseSchema,
  notificationPreferencesUpdateRequestSchema,
  openclawDisplayPreferencesResponseSchema,
  openclawDisplayPreferencesUpdateRequestSchema,
  openclawMessageWithActionsListResponseSchema,
  openclawPushNotificationPayloadSchema,
  openclawThreadListResponseSchema,
  okResponseSchema,
  pushRegisterRequestSchema,
  pushRegisterResponseSchema,
  pushResultSchema,
  pushSendRequestSchema,
  pushTestRequestSchema,
  pushUnregisterRequestSchema,
  pushUnregisterResponseSchema,
  roundupTestRequestSchema,
  roundupTestResultSchema,
  sourceCreateRequestSchema,
  sourceListResponseSchema,
  sourcePatchRequestSchema,
  sourceResponseSchema,
  sourceTokenResponseSchema,
  userDevicesResponseSchema,
  usersListResponseSchema,
} from "@maudecode/cowtail-protocol";
import type {
  HealthNode,
  HealthResponse,
  NotificationPreferences,
} from "@maudecode/cowtail-protocol";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { configuredApnsEnvironment } from "./apns";
import { AppleIdentityVerificationError, verifyAppleIdentityToken } from "./appleIdentity";
import { planAlertmanagerInvestigation } from "./alertmanagerBatching";
import { WATCHDOG_ALERTNAME } from "./pipelineStatus";
import { alertLifecycleDedupeKey, alertmanagerFingerprint } from "./alertLifecycle";
import { previewDeviceToken } from "./deviceTokenPreview";
import { hermesHookItem } from "./hermesHooks";
import { itemErrorCode } from "./items";
import { resolveItemStatsRange } from "./itemStats";
import {
  exchangeOidcCode,
  fetchOidcDiscovery,
  OidcError,
  oidcConfig,
  verifyOidcIdToken,
} from "./oidcIdentity";
import { validateOpenClawLimit } from "./openclawModel";
import { cowtailOwnerUserId, cowtailWebOrigin } from "./owner";
import { sendPushToUser } from "./pushDelivery";
import { resolveRoundupTimeZone } from "./roundup";
import { snoozeOptions } from "./itemModel";
import { SOURCE_TOKEN_PREFIX, sourceIconError } from "./sources";

const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "cowtail_session";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const app: HonoWithConvex<ActionCtx> = new Hono();
type RouteContext = Context;

app.use("/api/*", cors());

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  return /^Bearer\s+(\S+)$/.exec(c.req.header("authorization")?.trim() ?? "")?.[1];
}

// A source token reaches item ingest and its own items' events, and nothing else.
const SOURCE_TOKEN_ROUTES = [/^\/api\/items$/, /^\/api\/items\/[^/]+\/events$/];
app.use("/api/*", async (c, next) => {
  const sourceRoute =
    c.req.method === "POST" && SOURCE_TOKEN_ROUTES.some((route) => route.test(c.req.path));
  if (!sourceRoute && bearerToken(c)?.startsWith(SOURCE_TOKEN_PREFIX)) {
    return jsonError("Forbidden", 403);
  }
  await next();
});

function jsonError(message: string, status = 400, details?: Record<string, unknown>) {
  return Response.json({ ok: false, error: message, ...details }, { status });
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function shouldCreateInvestigationJobForReceiver(receiver: unknown): boolean {
  return nonEmptyString(receiver)?.split("/").at(-1) === "cowtail-investigate";
}

export function parseInvestigationOutcome(value: unknown) {
  const parsed = alertOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function extractAlertId(value: Record<string, unknown>): string | undefined {
  return (
    nonEmptyString(value.alertId) ?? nonEmptyString(value.alertID) ?? nonEmptyString(value.alert_id)
  );
}

function buildAlertURL(alertId: string): string {
  return `${cowtailWebOrigin()}/alerts/${encodeURIComponent(alertId)}`;
}

function enrichPushData(
  data: Record<string, unknown> | undefined,
  alertId: string | undefined,
): Record<string, unknown> | undefined {
  const enriched = data ? { ...data } : {};
  const resolvedAlertId = alertId ?? extractAlertId(enriched);

  if (!resolvedAlertId) {
    return Object.keys(enriched).length > 0 ? enriched : undefined;
  }

  enriched.alertId = resolvedAlertId;

  if (
    !nonEmptyString(enriched.url) &&
    !nonEmptyString(enriched.link) &&
    !nonEmptyString(enriched.deepLinkURL) &&
    !nonEmptyString(enriched.deepLinkUrl) &&
    !nonEmptyString(enriched.deep_link_url)
  ) {
    enriched.url = buildAlertURL(resolvedAlertId);
  }

  return enriched;
}

function buildOpenClawThreadURL(threadId: string): string {
  return `/openclaw/threads/${encodeURIComponent(threadId)}`;
}

function isOpenClawPushData(data: Record<string, unknown> | undefined): boolean {
  return (
    nonEmptyString(data?.kind)?.toLowerCase() === "openclaw" ||
    nonEmptyString(data?.type)?.toLowerCase() === "openclaw"
  );
}

export function normalizePushDataForSend(
  data: Record<string, unknown> | undefined,
  alertId: string | undefined,
): { ok: true; data: Record<string, unknown> | undefined } | { ok: false; error: string } {
  const enriched = enrichPushData(data, alertId);
  if (!isOpenClawPushData(enriched)) {
    return { ok: true, data: enriched };
  }

  const parsed = openclawPushNotificationPayloadSchema.safeParse({
    ...enriched,
    kind: "openclaw",
    type: undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: formatIssues(parsed.error.issues) };
  }

  return {
    ok: true,
    data: {
      ...parsed.data,
      url: parsed.data.url ?? buildOpenClawThreadURL(parsed.data.threadId),
    },
  };
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

export function isBearerTokenAuthorized(
  authorization: string | undefined,
  expectedTokens: Array<string | undefined>,
): boolean {
  const provided = authorization?.trim();
  return expectedTokens.some((token) => {
    const expected = token?.trim();
    return Boolean(expected) && provided === `Bearer ${expected}`;
  });
}

function requireServiceOrWorkerAuth(c: { req: { header(name: string): string | undefined } }) {
  const expectedTokens = [process.env.PUSH_API_BEARER_TOKEN, process.env.COWTAIL_WORKER_TOKEN];
  if (!expectedTokens.some((token) => Boolean(token?.trim()))) {
    return jsonError("Cowtail service and worker tokens are not configured", 500);
  }

  if (!isBearerTokenAuthorized(c.req.header("authorization"), expectedTokens)) {
    return jsonError("Unauthorized", 401);
  }

  return null;
}

function requireBearerAuth(
  c: { req: { header(name: string): string | undefined } },
  expectedToken: string | undefined,
  missingMessage: string,
) {
  const expected = expectedToken?.trim();
  if (!expected) {
    return jsonError(missingMessage, 500);
  }

  const authorization = c.req.header("authorization")?.trim();
  if (authorization !== `Bearer ${expected}`) {
    return jsonError("Unauthorized", 401);
  }

  return null;
}

function requireAlertmanagerWebhookAuth(c: { req: { header(name: string): string | undefined } }) {
  return requireBearerAuth(
    c,
    process.env.COWTAIL_ALERTMANAGER_WEBHOOK_TOKEN ?? process.env.PUSH_API_BEARER_TOKEN,
    "Alertmanager webhook token is not configured",
  );
}

function requireWorkerAuth(c: { req: { header(name: string): string | undefined } }) {
  return requireBearerAuth(
    c,
    process.env.COWTAIL_WORKER_TOKEN,
    "Cowtail worker token is not configured",
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBase64Url(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// RFC 7636 S256: base64url(SHA-256(ASCII verifier)).
async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

// The one place a session is created: Apple sign-in, the OIDC web callback and the OIDC
// iOS hand-off all issue through it.
async function issueSession(ctx: ActionCtx, userId: string) {
  const token = createOpaqueToken();
  const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
  await ctx.runMutation(internal.authSessions.createSession, {
    userId,
    tokenHash: await sha256Hex(token),
    expiresAt,
  });

  return { token, userId, expiresAt };
}

type AppSessionContext = Context<typeof app extends Hono<infer Env> ? Env : never>;

// A bearer token wins when present. Without one, the `cowtail_session` cookie is accepted,
// and a state-changing cookie request must come from the web origin (CSRF).
async function requireAppSession(c: AppSessionContext) {
  const authorization = c.req.header("authorization")?.trim();
  let token: string | undefined;
  if (authorization) {
    if (!authorization.startsWith("Bearer ")) {
      return { error: jsonError("Unauthorized", 401) };
    }
    token = authorization.slice("Bearer ".length).trim();
  } else {
    token = getCookie(c, SESSION_COOKIE)?.trim();
    if (
      token &&
      UNSAFE_METHODS.has(c.req.method.toUpperCase()) &&
      c.req.header("origin") !== cowtailWebOrigin()
    ) {
      return { error: jsonError("Forbidden", 403) };
    }
  }

  if (!token) {
    return { error: jsonError("Unauthorized", 401) };
  }

  const tokenHash = await sha256Hex(token);
  const session = await c.env.runQuery(internal.authSessions.getSessionByTokenHash, { tokenHash });

  if (!session || session.revokedAt || session.expiresAt <= Date.now()) {
    return { error: jsonError("Unauthorized", 401) };
  }

  await c.env.runMutation(internal.authSessions.touchSession, {
    id: session._id,
  });

  return {
    session,
    userId: session.userId,
  };
}

export function requireOpenClawOwner(auth: { userId: string }) {
  return requireCowtailOwner(auth, "OpenClaw owner user ID is not configured");
}

export function requireCowtailOwner(
  auth: { userId: string },
  missingMessage = "Cowtail owner user ID is not configured",
) {
  const ownerUserId = cowtailOwnerUserId();
  if (!ownerUserId) {
    return jsonError(missingMessage, 500);
  }

  if (auth.userId !== ownerUserId) {
    return jsonError("Forbidden", 403);
  }

  return null;
}

function parseOptionalQueryTimestamp(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export function parseOpenClawListLimit(
  value: string | undefined,
): { limit: number | undefined } | { error: string } {
  if (value === undefined) {
    return { limit: undefined };
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { error: "limit must be an integer between 1 and 500" };
  }

  const parsed = Number(trimmed);
  try {
    return { limit: validateOpenClawLimit(parsed) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "limit must be an integer between 1 and 500",
    };
  }
}

function isConvexArgumentValidationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("ArgumentValidationError") ||
    message.includes("Value does not match validator") ||
    message.includes("Invalid id")
  );
}

function mapAlertRecord(alert: Record<string, unknown> & { _id: string }) {
  return alertRecordSchema.parse({
    id: String(alert._id),
    timestamp: alert.timestamp,
    alertname: alert.alertname,
    severity: alert.severity,
    namespace: alert.namespace,
    node: alert.node,
    status: alert.status,
    outcome: alert.outcome,
    summary: alert.summary,
    action: alert.action,
    rootCause: alert.rootCause,
    messaged: alert.messaged,
    resolvedAt: alert.resolvedAt,
    source: alert.source,
    sourceEventId: alert.sourceEventId ? String(alert.sourceEventId) : undefined,
    alertmanagerFingerprint: alert.alertmanagerFingerprint,
    dedupeKey: alert.dedupeKey,
    startsAt: alert.startsAt,
    endsAt: alert.endsAt,
    generatorURL: alert.generatorURL,
    labels: alert.labels,
    annotations: alert.annotations,
    lastReceivedAt: alert.lastReceivedAt,
    occurrenceCount: alert.occurrenceCount,
    investigation: alert.investigation,
    ownerDisposition: alert.ownerDisposition,
    ownerNote: alert.ownerNote,
    ownerUpdatedAt: alert.ownerUpdatedAt,
  });
}

function mapFixRecord(fix: Record<string, unknown> & { _id: string }) {
  return {
    id: String(fix._id),
    timestamp: fix.timestamp,
    alertIds: fix.alertIds,
    description: fix.description,
    rootCause: fix.rootCause,
    scope: fix.scope,
    commit: fix.commit,
  };
}

type AlertmanagerAlert = {
  status?: unknown;
  labels?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  startsAt?: unknown;
  endsAt?: unknown;
  generatorURL?: unknown;
  fingerprint?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function labelString(labels: Record<string, unknown>, key: string, fallback = "unknown"): string {
  return nonEmptyString(labels[key]) ?? fallback;
}

function parseAlertTimestamp(value: unknown, fallback: number): number {
  const text = nonEmptyString(value);
  if (!text) return fallback;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function alertSummary(alert: AlertmanagerAlert): string {
  const labels = asRecord(alert.labels);
  const annotations = asRecord(alert.annotations);
  return (
    nonEmptyString(annotations.description) ??
    nonEmptyString(annotations.summary) ??
    `${labelString(labels, "alertname")} ${nonEmptyString(alert.status) ?? "firing"}`
  );
}

function alertNode(alert: AlertmanagerAlert): string | undefined {
  const labels = asRecord(alert.labels);
  return (
    nonEmptyString(labels.node) ??
    nonEmptyString(labels.kubernetes_node) ??
    nonEmptyString(labels.instance)
  );
}

function normalizeAlertmanagerAlert(alert: AlertmanagerAlert, receivedAt: number) {
  const labels = asRecord(alert.labels);
  const annotations = asRecord(alert.annotations);
  const status = nonEmptyString(alert.status) ?? "firing";
  const startsAtText = nonEmptyString(alert.startsAt);
  const startsAt = startsAtText ? parseAlertTimestamp(startsAtText, receivedAt) : undefined;
  const endsAt = status === "resolved" ? parseAlertTimestamp(alert.endsAt, receivedAt) : undefined;
  const fingerprint = alertmanagerFingerprint(alert.fingerprint, labels);

  return {
    dedupeKey: alertLifecycleDedupeKey(fingerprint, startsAt),
    alertmanagerFingerprint: fingerprint,
    timestamp: startsAt ?? receivedAt,
    startsAt,
    endsAt,
    generatorURL: nonEmptyString(alert.generatorURL),
    alertname: labelString(labels, "alertname"),
    severity: labelString(labels, "severity", "warning"),
    namespace: labelString(labels, "namespace"),
    node: alertNode(alert),
    status,
    summary: alertSummary(alert),
    labels,
    annotations,
  };
}

function generateClaimToken(): string {
  return createOpaqueToken();
}

function mapUserDevice(device: Record<string, unknown>) {
  const deviceToken = String(device.deviceToken);
  return {
    id: String(device._id),
    deviceTokenPreview: previewDeviceToken(deviceToken),
    platform: String(device.platform),
    environment: String(device.environment),
    enabled: Boolean(device.enabled),
    deviceName:
      typeof device.deviceName === "string" && device.deviceName.trim() !== ""
        ? device.deviceName
        : undefined,
    lastSeenAt: Number(device.lastSeenAt),
    createdAt: Number(device.createdAt),
    updatedAt: Number(device.updatedAt),
  };
}

function formatIssues(issues: Array<{ message: string; path?: ReadonlyArray<PropertyKey> }>) {
  return issues
    .map((issue) => {
      const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

type PrometheusResult = {
  metric: Record<string, string>;
  value: [number, string];
};

type PrometheusResponse = {
  status: string;
  data?: {
    result?: PrometheusResult[];
  };
};

function prometheusBaseUrl(): string {
  const configured = nonEmptyString(process.env.PROMETHEUS_BASE_URL);
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return `${cowtailWebOrigin()}/prometheus`;
}

function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function prometheusValue(result: PrometheusResult): number {
  return Number.parseFloat(result.value[1]);
}

async function promQuery(query: string): Promise<PrometheusResult[]> {
  const url = new URL(`${prometheusBaseUrl()}/api/v1/query`);
  url.searchParams.set("query", query);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Prometheus query failed with status ${response.status}`);
  }

  if (looksLikeHtml(body)) {
    if (body.toLowerCase().includes("cloudflare access")) {
      throw new Error("Prometheus query was blocked by Cloudflare Access");
    }

    throw new Error("Prometheus returned HTML instead of JSON");
  }

  let data: PrometheusResponse;
  try {
    data = JSON.parse(body) as PrometheusResponse;
  } catch {
    throw new Error("Prometheus returned invalid JSON");
  }

  if (data.status !== "success" || !Array.isArray(data.data?.result)) {
    throw new Error("Prometheus query did not return a success result");
  }

  return data.data.result;
}

async function fetchClusterHealth(): Promise<HealthResponse> {
  const [
    cpuResults,
    memoryResults,
    readyResults,
    cephHealthResults,
    storageTotalResults,
    storageUsedResults,
  ] = await Promise.all([
    promQuery(
      '(1 - avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100 * on(instance) group_left(nodename) node_uname_info',
    ),
    promQuery(
      "(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 * on(instance) group_left(nodename) node_uname_info",
    ),
    promQuery('kube_node_status_condition{condition="Ready",status="true"}'),
    promQuery("ceph_health_status"),
    promQuery("ceph_cluster_total_bytes"),
    promQuery("ceph_cluster_total_used_bytes"),
  ]);

  const readyNodes = new Set(
    readyResults
      .filter((result) => prometheusValue(result) === 1)
      .map((result) => result.metric.node)
      .filter(Boolean),
  );

  const cpuByNode = new Map<string, number>();
  for (const result of cpuResults) {
    const nodeName = result.metric.nodename;
    if (nodeName) {
      cpuByNode.set(nodeName, Math.round(prometheusValue(result)));
    }
  }

  const memoryByNode = new Map<string, number>();
  for (const result of memoryResults) {
    const nodeName = result.metric.nodename;
    if (nodeName) {
      memoryByNode.set(nodeName, Math.round(prometheusValue(result)));
    }
  }

  const nodeNames = new Set([...cpuByNode.keys(), ...memoryByNode.keys()]);
  const nodes: HealthNode[] = Array.from(nodeNames)
    .sort()
    .map((name) => ({
      name,
      status: readyNodes.has(name) ? "Ready" : "NotReady",
      cpu: cpuByNode.get(name) ?? 0,
      memory: memoryByNode.get(name) ?? 0,
    }));

  const cephStatusValue =
    cephHealthResults.length > 0 ? Math.round(prometheusValue(cephHealthResults[0])) : 0;
  const cephStatusMap: Record<number, HealthResponse["cephStatus"]> = {
    0: "HEALTH_OK",
    1: "HEALTH_WARN",
    2: "HEALTH_ERR",
  };

  const totalTiB =
    storageTotalResults.length > 0 ? prometheusValue(storageTotalResults[0]) / 1024 ** 4 : 0;
  const usedTiB =
    storageUsedResults.length > 0 ? prometheusValue(storageUsedResults[0]) / 1024 ** 4 : 0;

  return {
    version: 1,
    nodes,
    readyNodes: nodes.filter((node) => node.status === "Ready").length,
    cephStatus: cephStatusMap[cephStatusValue] ?? "HEALTH_OK",
    cephMessage: cephStatusValue === 0 ? "All PGs active+clean" : "Degraded — check Ceph dashboard",
    storageUsed: Number.parseFloat(usedTiB.toFixed(2)),
    storageTotal: Number.parseFloat(totalTiB.toFixed(2)),
    storageUnit: "TiB",
  };
}

// POST /api/alerts — write endpoint
app.post("/api/alerts", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

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
  const id = await ctx.runMutation(internal.alerts.insert, args as any);
  return c.json(createResponseSchema.parse({ ok: true, id }));
});

// GET /api/alerts — list alerts with optional filters
app.get("/api/alerts", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const rawQuery = {
    from: parseOptionalQueryTimestamp(c.req.query("from")),
    to: parseOptionalQueryTimestamp(c.req.query("to")),
    alertname: nonEmptyString(c.req.query("alertname")),
    severity: nonEmptyString(c.req.query("severity")),
    namespace: nonEmptyString(c.req.query("namespace")),
    status: nonEmptyString(c.req.query("status")),
    outcome: nonEmptyString(c.req.query("outcome")),
  };

  const parsedQuery = alertListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return jsonError(formatIssues(parsedQuery.error.issues));
  }

  const alerts = await c.env.runQuery(internal.alerts.getAll, {});
  const filtered = alerts
    .filter(
      (alert: any) =>
        parsedQuery.data.from === undefined || alert.timestamp >= parsedQuery.data.from,
    )
    .filter(
      (alert: any) => parsedQuery.data.to === undefined || alert.timestamp <= parsedQuery.data.to,
    )
    .filter(
      (alert: any) =>
        parsedQuery.data.alertname === undefined || alert.alertname === parsedQuery.data.alertname,
    )
    .filter(
      (alert: any) =>
        parsedQuery.data.severity === undefined || alert.severity === parsedQuery.data.severity,
    )
    .filter(
      (alert: any) =>
        parsedQuery.data.namespace === undefined || alert.namespace === parsedQuery.data.namespace,
    )
    .filter(
      (alert: any) =>
        parsedQuery.data.status === undefined || alert.status === parsedQuery.data.status,
    )
    .filter(
      (alert: any) =>
        parsedQuery.data.outcome === undefined || alert.outcome === parsedQuery.data.outcome,
    )
    .map((alert: any) => mapAlertRecord(alert as any));

  return c.json(
    alertListResponseSchema.parse({
      ok: true,
      count: filtered.length,
      alerts: filtered,
    }),
  );
});

// GET /api/alerts/:id — fetch a single alert
app.get("/api/alerts/:id", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const alert = await c.env.runQuery(internal.alerts.getById, {
    id: c.req.param("id") as any,
  });

  if (!alert) {
    return jsonError("Alert not found", 404);
  }

  return c.json(
    alertGetResponseSchema.parse({
      ok: true,
      alert: mapAlertRecord(alert as any),
    }),
  );
});

// DELETE /api/alerts/:id — delete a single alert
app.delete("/api/alerts/:id", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const ctx = c.env;
  const id = c.req.param("id");
  try {
    await ctx.runMutation(internal.alerts.deleteById, { id: id as any });
    return c.json(okResponseSchema.parse({ ok: true }));
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 400);
  }
});

// POST /api/fixes — write endpoint
app.post("/api/fixes", async (c) => {
  const authError = requireServiceOrWorkerAuth(c);
  if (authError) return authError;

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
  const id = await ctx.runMutation(internal.fixes.insert, args as any);
  return c.json(createResponseSchema.parse({ ok: true, id }));
});

// GET /api/fixes — list fixes with optional filters
app.get("/api/fixes", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const rawQuery = {
    from: parseOptionalQueryTimestamp(c.req.query("from")),
    to: parseOptionalQueryTimestamp(c.req.query("to")),
    scope: nonEmptyString(c.req.query("scope")),
    alertId: nonEmptyString(c.req.query("alertId")) ?? nonEmptyString(c.req.query("alert-id")),
  };

  const parsedQuery = fixListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return jsonError(formatIssues(parsedQuery.error.issues));
  }

  const fixes = await c.env.runQuery(internal.fixes.getAll, {});
  const filtered = fixes
    .filter(
      (fix: any) => parsedQuery.data.from === undefined || fix.timestamp >= parsedQuery.data.from,
    )
    .filter((fix: any) => parsedQuery.data.to === undefined || fix.timestamp <= parsedQuery.data.to)
    .filter(
      (fix: any) => parsedQuery.data.scope === undefined || fix.scope === parsedQuery.data.scope,
    )
    .filter(
      (fix: any) =>
        parsedQuery.data.alertId === undefined ||
        fix.alertIds.includes(parsedQuery.data.alertId as any),
    )
    .map((fix: any) => mapFixRecord(fix as any));

  return c.json(
    fixListResponseSchema.parse({
      ok: true,
      count: filtered.length,
      fixes: filtered,
    }),
  );
});

// GET /api/fixes/:id — fetch a single fix
app.get("/api/fixes/:id", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const fix = await c.env.runQuery(internal.fixes.getById, {
    id: c.req.param("id") as any,
  });

  if (!fix) {
    return jsonError("Fix not found", 404);
  }

  return c.json(
    fixGetResponseSchema.parse({
      ok: true,
      fix: mapFixRecord(fix as any),
    }),
  );
});

// DELETE /api/fixes/:id — delete a single fix
app.delete("/api/fixes/:id", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const ctx = c.env;
  const id = c.req.param("id");
  try {
    await ctx.runMutation(internal.fixes.deleteById, { id: id as any });
    return c.json(okResponseSchema.parse({ ok: true }));
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 400);
  }
});

// POST /api/alerts/webhook — Alertmanager-native durable webhook receiver
// Writes the raw Alertmanager event first, then upserts normalized alerts and queues investigation jobs.
app.post("/api/alerts/webhook", async (c) => {
  const authError = requireAlertmanagerWebhookAuth(c);
  if (authError) return authError;

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.alerts) || payload.alerts.length === 0) {
    return c.json({ ok: false, error: "No alerts in payload" }, 400);
  }

  const receivedAt = Date.now();
  // The Watchdog is the pipeline's heartbeat, never an alert: it is left out of the batch.
  const isWatchdog = (alert: unknown) =>
    asRecord(asRecord(alert).labels).alertname === WATCHDOG_ALERTNAME;
  if (
    payload.alerts.some(
      (alert) =>
        isWatchdog(alert) && (nonEmptyString(asRecord(alert).status) ?? "firing") === "firing",
    )
  ) {
    await c.env.runMutation((internal as any).pipelineStatus.recordWatchdog, { now: receivedAt });
  }
  const alerts = payload.alerts.filter((alert) => !isWatchdog(alert));
  if (alerts.length === 0) {
    return c.json({ ok: true, alertIds: [], jobIds: [], deliveryIds: [], count: 0 });
  }

  const payloadHash = await sha256Hex(JSON.stringify(payload));
  const eventId = await c.env.runMutation((internal as any).alertmanagerEvents.insertStored, {
    receivedAt,
    receiver: nonEmptyString(payload.receiver),
    status: nonEmptyString(payload.status) ?? "unknown",
    groupKey: nonEmptyString(payload.groupKey),
    groupLabels: asRecord(payload.groupLabels),
    externalURL: nonEmptyString(payload.externalURL),
    version: nonEmptyString(payload.version),
    truncatedAlerts:
      typeof payload.truncatedAlerts === "number" ? payload.truncatedAlerts : undefined,
    commonLabels: asRecord(payload.commonLabels),
    commonAnnotations: asRecord(payload.commonAnnotations),
    rawPayload: payload,
    payloadHash,
  });

  const alertIds: string[] = [];
  const storedAlertIds: any[] = [];
  const jobIds: string[] = [];
  const deliveryIds: string[] = [];
  const investigationAlertIds: string[] = [];

  const shouldCreateInvestigationJobs = shouldCreateInvestigationJobForReceiver(payload.receiver);
  const normalizedAlerts = alerts.map((rawAlert) =>
    normalizeAlertmanagerAlert(rawAlert as AlertmanagerAlert, receivedAt),
  );
  const investigationPlan = shouldCreateInvestigationJobs
    ? planAlertmanagerInvestigation(normalizedAlerts)
    : { candidateIndex: undefined, firingIndexes: [] };
  const investigationIndexes = new Set(investigationPlan.firingIndexes);

  try {
    for (const [index, normalized] of normalizedAlerts.entries()) {
      const investigationPending = index === investigationPlan.candidateIndex;
      const alertId = await c.env.runMutation((internal as any).alerts.upsertFromAlertmanager, {
        sourceEventId: eventId,
        investigationPending,
        ...normalized,
      });
      alertIds.push(String(alertId));
      storedAlertIds.push(alertId);

      if (investigationIndexes.has(index)) {
        investigationAlertIds.push(String(alertId));
      }
    }

    await c.env.runMutation((internal as any).alertmanagerEvents.markNormalized, {
      id: eventId,
      createdAlertIds: alertIds,
      createdJobIds: [],
      investigationAlertIds: [...new Set(investigationAlertIds)],
    });

    if (investigationPlan.candidateIndex !== undefined) {
      const normalized = normalizedAlerts[investigationPlan.candidateIndex];
      const alertId = storedAlertIds[investigationPlan.candidateIndex];
      const jobId = await c.env.runMutation(
        (internal as any).investigationJobs.createOrCoalesceForAlert,
        {
          alertId,
          sourceEventId: eventId,
          fingerprint: normalized.alertmanagerFingerprint,
          dedupeKey: normalized.dedupeKey,
          alertStatus: normalized.status,
          severity: normalized.severity,
          now: receivedAt,
        },
      );

      if (jobId) {
        jobIds.push(String(jobId));
        await c.env.runMutation((internal as any).alertmanagerEvents.markJobsCreated, {
          id: eventId,
          createdJobIds: jobIds,
        });
        const deliveryId = await c.env.runMutation((internal as any).jobDeliveries.enqueue, {
          jobId,
          now: receivedAt,
        });
        deliveryIds.push(String(deliveryId));
      }
    }

    for (const deliveryId of deliveryIds) {
      await attemptHermesJobDelivery(c, deliveryId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await c.env.runMutation((internal as any).alertmanagerEvents.markFailed, {
      id: eventId,
      error: message,
    });
    return c.json({ ok: false, error: message, eventId: String(eventId) }, 500);
  }

  return c.json({
    ok: true,
    eventId: String(eventId),
    alertIds,
    jobIds,
    deliveryIds,
    count: alertIds.length,
  });
});

async function loadInvestigationJobContext(c: RouteContext, job: any) {
  const alert = job?.alertId
    ? await c.env.runQuery((internal as any).alerts.getById, { id: job.alertId })
    : null;
  const sourceEvent = job?.sourceEventId
    ? await c.env.runQuery((internal as any).alertmanagerEvents.getById, { id: job.sourceEventId })
    : null;
  const relatedAlerts = sourceEvent?.investigationAlertIds
    ? await c.env.runQuery((internal as any).alerts.getByIds, {
        ids: sourceEvent.investigationAlertIds,
      })
    : job?.sourceEventId
      ? await c.env.runQuery((internal as any).alerts.getBySourceEventId, {
          sourceEventId: job.sourceEventId,
        })
      : [];

  const memberIds = [...new Set([job?.alertId, ...relatedAlerts.map((a: any) => a._id)])];
  const priorOccurrences = await c.env.runQuery((internal as any).priorOccurrences.forAlerts, {
    alertIds: memberIds.filter(Boolean),
  });

  return {
    job,
    alert: alert ? mapAlertRecord(alert as any) : null,
    relatedAlerts: relatedAlerts.map((relatedAlert: any) => mapAlertRecord(relatedAlert)),
    // Each member alert's earlier firings, by alert ID, newest first.
    priorOccurrences,
    sourceEvent: sourceEvent
      ? {
          id: String(sourceEvent._id),
          receivedAt: sourceEvent.receivedAt,
          receiver: sourceEvent.receiver,
          status: sourceEvent.status,
          groupKey: sourceEvent.groupKey,
          groupLabels: sourceEvent.groupLabels,
          commonLabels: sourceEvent.commonLabels,
          commonAnnotations: sourceEvent.commonAnnotations,
          externalURL: sourceEvent.externalURL,
          version: sourceEvent.version,
          truncatedAlerts: sourceEvent.truncatedAlerts,
          ingestStatus: sourceEvent.ingestStatus,
        }
      : null,
  };
}

async function attemptHermesJobDelivery(c: RouteContext, deliveryId: string) {
  return await c.env.runAction((internal as any).jobDeliveryActions.deliverOne, {
    deliveryId: deliveryId as any,
  });
}

app.post("/api/investigation-jobs/claim", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const now = Date.now();
  const job = await c.env.runMutation((internal as any).investigationJobs.claim, {
    jobId: nonEmptyString(body.jobId) as any,
    workerId: nonEmptyString(body.workerId) ?? "hermes-default-gateway",
    claimToken: generateClaimToken(),
    leaseSeconds: typeof body.leaseSeconds === "number" ? body.leaseSeconds : 900,
    now,
  });

  if (!job) {
    return c.json({ ok: true, claimed: false });
  }

  return c.json({ ok: true, claimed: true, ...(await loadInvestigationJobContext(c, job)) });
});

app.get("/api/investigation-jobs/deadletters", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const limit = parseOptionalQueryTimestamp(c.req.query("limit")) ?? 50;
  const jobs = await c.env.runQuery((internal as any).investigationJobs.deadletters, { limit });
  return c.json({ ok: true, count: jobs.length, jobs });
});

app.post("/api/job-deliveries/:id/retry", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const result = await attemptHermesJobDelivery(c, c.req.param("id"));
  return c.json(result);
});

app.get("/api/investigation-jobs/:id", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const job = await c.env.runQuery((internal as any).investigationJobs.getById, {
    id: c.req.param("id") as any,
  });
  if (!job) {
    return jsonError("Investigation job not found", 404);
  }

  return c.json({ ok: true, ...(await loadInvestigationJobContext(c, job)) });
});

app.post("/api/investigation-jobs/:id/renew", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const claimToken = nonEmptyString(body.claimToken);
  if (!claimToken) {
    return jsonError("claimToken is required");
  }

  const result = await c.env.runMutation((internal as any).investigationJobs.renew, {
    id: c.req.param("id") as any,
    claimToken,
    leaseSeconds: typeof body.leaseSeconds === "number" ? body.leaseSeconds : 900,
    now: Date.now(),
  });
  return c.json({ ok: true, ...result });
});

app.post("/api/investigation-jobs/:id/complete", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return jsonError("Invalid JSON body");
  }
  const claimToken = nonEmptyString(body.claimToken);
  if (!claimToken) {
    return jsonError("claimToken is required");
  }

  const job = await c.env.runQuery((internal as any).investigationJobs.getById, {
    id: c.req.param("id") as any,
  });
  if (!job) {
    return jsonError("Investigation job not found", 404);
  }

  let rawResults: unknown[];
  if (Array.isArray(body.results)) {
    rawResults = body.results;
  } else {
    const outcome = parseInvestigationOutcome(body.outcome);
    const summary = nonEmptyString(body.summary);
    const action = nonEmptyString(body.action);
    if (!outcome || !summary || !action) {
      return jsonError("results, or a valid legacy outcome with summary and action, are required");
    }
    rawResults = [
      {
        alertId: String(job.alertId),
        outcome,
        summary,
        action,
        rootCause: nonEmptyString(body.rootCause),
        messaged: typeof body.messaged === "boolean" ? body.messaged : false,
        evidence: body.evidence,
      },
    ];
  }

  const results = [];
  for (const value of rawResults) {
    const result =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const resultOutcome = parseInvestigationOutcome(result?.outcome);
    const alertId = nonEmptyString(result?.alertId);
    const resultSummary = nonEmptyString(result?.summary);
    const resultAction = nonEmptyString(result?.action);
    if (!result || !resultOutcome || !alertId || !resultSummary || !resultAction) {
      return jsonError("each batch result requires alertId, a valid outcome, summary, and action");
    }
    const evidence = investigationEvidenceSchema.optional().safeParse(result.evidence ?? undefined);
    if (!evidence.success) {
      return jsonError(`evidence: ${formatIssues(evidence.error.issues)}`);
    }
    results.push({
      alertId,
      outcome: resultOutcome,
      summary: resultSummary,
      action: resultAction,
      rootCause: nonEmptyString(result.rootCause),
      messaged: typeof result.messaged === "boolean" ? result.messaged : false,
      evidence: evidence.data,
    });
  }

  try {
    const result = await c.env.runMutation((internal as any).investigationJobs.completeBatch, {
      id: c.req.param("id") as any,
      claimToken,
      results,
      now: Date.now(),
    });
    return c.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ConvexError && error.data?.code === "INVESTIGATION_MEMBERS_UNRESOLVED") {
      return jsonError("Investigation completion requires every member alert to be resolved", 409, {
        code: error.data.code,
        unresolvedAlertIds: error.data.unresolvedAlertIds,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("batch results must cover every firing alert") ||
      message.includes("pending is not terminal")
    ) {
      return jsonError(message, 409);
    }
    throw error;
  }
});

app.post("/api/investigation-jobs/:id/fail", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return jsonError("Invalid JSON body");
  }
  const phase = nonEmptyString(body.phase) ?? "investigation";
  const error = nonEmptyString(body.error);
  if (!error) {
    return jsonError("error is required");
  }
  const claimToken = nonEmptyString(body.claimToken);
  if (!claimToken) {
    return jsonError("claimToken is required");
  }

  const result = await c.env.runMutation((internal as any).investigationJobs.fail, {
    id: c.req.param("id") as any,
    claimToken,
    phase,
    error,
    retryable: typeof body.retryable === "boolean" ? body.retryable : true,
    now: Date.now(),
  });
  return c.json({ ok: true, ...result });
});

app.post("/api/investigation-jobs/:id/requeue", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const id = c.req.param("id") as any;
  const job = await c.env.runQuery((internal as any).investigationJobs.getById, { id });
  if (!job) {
    return jsonError("Investigation job not found", 404);
  }

  await c.env.runMutation((internal as any).alerts.updateOutcome, {
    id: job.alertId,
    outcome: "pending",
    summary: "Investigation requeued for another worker attempt.",
    action: "Cowtail durable investigation requeued.",
    messaged: false,
  });

  const result = await c.env.runMutation((internal as any).investigationJobs.requeue, {
    id,
    now: Date.now(),
  });
  await c.env.runMutation((internal as any).jobDeliveries.enqueue, {
    jobId: id,
    now: Date.now(),
    freshAttempt: true,
  });
  return c.json({ ok: true, ...result });
});

app.post("/api/me/alerts/:id/actions", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;
  const ownerError = requireCowtailOwner(auth);
  if (ownerError) return ownerError;

  const body = await c.req.json().catch(() => null);
  const parsed = alertHumanActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  const id = c.req.param("id") as Id<"alerts">;
  const alert = await c.env.runQuery((internal as any).alerts.getById, { id });
  if (!alert) return jsonError("Alert not found", 404);

  const now = Date.now();
  const note = nonEmptyString(parsed.data.note);

  try {
    await c.env.runMutation((internal as any).alerts.applyOwnerAction, {
      id,
      action: parsed.data.action,
      note,
      now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no investigation to retry") || message.includes("already in progress")) {
      return jsonError(message, 409);
    }
    throw error;
  }

  const updated = await c.env.runQuery((internal as any).alerts.getByIdForOwner, { id });
  if (!updated) return jsonError("Alert not found after update", 404);
  return c.json(
    alertHumanActionResponseSchema.parse({
      ok: true,
      alert: mapAlertRecord(updated as Record<string, unknown> & { _id: string }),
    }),
  );
});

// --- Items ----------------------------------------------------------------------------

const ITEM_LIST_DEFAULT_LIMIT = 100;
const codedErrorStatus: Record<string, [number, string]> = {
  ITEM_NOT_FOUND: [404, "Item not found"],
  ITEM_OTHER_SOURCE: [403, "Forbidden"],
  SOURCE_NOT_FOUND: [404, "Source not found"],
  SOURCE_EXISTS: [409, "Source already exists"],
  ITEM_CLOSED: [409, "Item is already closed"],
  ACTION_NOT_OFFERED: [409, "Item does not offer this action"],
  APPROVAL_NEEDS_AUTH: [403, "Approvals need Face ID: answer again in Cowtail"],
  INVALID_SNOOZE: [400, "Snooze must end in the future"],
  ITEM_NOT_SNOOZED: [409, "Item is not snoozed"],
  ANSWER_PENDING: [409, "An answer to this item is already on its way"],
  RESPONSE_NOT_FOUND: [404, "Response not found"],
  RESPONSE_NOT_CLAIMED: [409, "Response is not claimed with this token"],
};

function codedErrorResponse(error: unknown) {
  const code = itemErrorCode(error);
  const known = code ? codedErrorStatus[code] : undefined;
  if (!known) throw error;
  return jsonError(known[1], known[0], { code });
}

// Readers of items, alerts and fixes are trusted services (the CLI, Hermes) or the owner's
// app session.
async function requireItemReader(c: RouteContext) {
  const serviceTokens = [process.env.PUSH_API_BEARER_TOKEN, process.env.COWTAIL_WORKER_TOKEN];
  if (isBearerTokenAuthorized(c.req.header("authorization"), serviceTokens)) return null;
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;
  return requireCowtailOwner(auth);
}

async function itemResponse(c: RouteContext, id: string) {
  const result = await c.env.runQuery((internal as any).items.get, { id });
  if (!result) return jsonError("Item not found", 404);
  return c.json(itemResponseSchema.parse({ ok: true, item: result.item }));
}

// A source token posts as its source; a service or worker token posts as any registered one.
async function requireItemProducer(c: RouteContext): Promise<{ source?: string } | Response> {
  const token = bearerToken(c);
  if (token?.startsWith(SOURCE_TOKEN_PREFIX)) {
    const source = await c.env.runQuery((internal as any).sources.getByTokenHash, {
      tokenHash: await sha256Hex(token),
    });
    return source?.enabled ? { source: source.slug } : jsonError("Forbidden", 403);
  }
  return requireServiceOrWorkerAuth(c) ?? {};
}

// POST /api/items — create an item, or count a repeat into the open item with its dedupeKey
app.post("/api/items", async (c) => {
  const producer = await requireItemProducer(c);
  if (producer instanceof Response) return producer;

  const body = await c.req.json().catch(() => null);
  // A source token's own source wins, so the body's `source` is ignored, even a malformed one.
  const parsed = itemCreateRequestSchema.safeParse(
    producer.source && body && typeof body === "object" ? { ...body, source: undefined } : body,
  );
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));
  // The owner's answers to an item go to the Hermes worker, so only the worker may route them.
  const fromWorker = isBearerTokenAuthorized(c.req.header("authorization"), [
    process.env.COWTAIL_WORKER_TOKEN,
  ]);
  if (parsed.data.replyTo && !fromWorker) {
    return jsonError("Only the worker token may set replyTo", 403);
  }

  const source = producer.source ?? parsed.data.source;
  if (!source) return jsonError("source is required");
  if (
    !producer.source &&
    !(await c.env.runQuery((internal as any).sources.getBySlug, { slug: source }))
  ) {
    return jsonError(`Unknown source: ${source}`);
  }

  const result = await c.env.runMutation((internal as any).items.create, {
    ...parsed.data,
    source,
    now: Date.now(),
  });
  return c.json(itemCreateResponseSchema.parse({ ok: true, ...result }));
});

// Hermes signs each outbound webhook GitHub-style: `sha256=<hex HMAC-SHA256 of the raw body>`.
// `crypto.subtle.verify` compares the MAC in constant time.
async function verifyHermesSignature(secret: string, body: ArrayBuffer, header?: string) {
  const hex = header?.trim().match(/^sha256=([0-9a-f]{64})$/i)?.[1];
  if (!hex) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16));
  return await crypto.subtle.verify("HMAC", key, signature, body);
}

// POST /api/hermes/hooks — Hermes outbound webhooks; the events Cowtail knows become items
app.post("/api/hermes/hooks", async (c) => {
  const secret = process.env.COWTAIL_HERMES_HOOK_SECRET;
  if (!secret?.trim()) return jsonError("Hermes hook secret is not configured", 500);

  const body = await c.req.arrayBuffer();
  if (!(await verifyHermesSignature(secret, body, c.req.header("x-hermes-signature-256")))) {
    return jsonError("Unauthorized", 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonError("Invalid JSON body");
  }
  const parsed = hermesHookPayloadSchema.safeParse(json);
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  const hook = hermesHookItem(parsed.data);
  if (hook) {
    await c.env.runMutation((internal as any).hermesHooks.ingest, {
      deliveryId: parsed.data.delivery_id,
      errorStorm: hook.errorStorm,
      // The same limits as POST /api/items, so the stored item reads back.
      item: itemCreateRequestSchema.parse(hook.item),
      now: Date.now(),
    });
  }
  return c.json(okResponseSchema.parse({ ok: true }));
});

// POST /api/items/:id/events — a producer's progress note, or its resolution or expiry
app.post("/api/items/:id/events", async (c) => {
  const producer = await requireItemProducer(c);
  if (producer instanceof Response) return producer;

  const parsed = itemEventAppendRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  const { actor, ...event } = parsed.data;
  const id = c.req.param("id");
  try {
    await c.env.runMutation((internal as any).items.appendEvent, {
      id,
      event,
      actor: producer.source ?? actor ?? "service",
      source: producer.source,
      now: Date.now(),
    });
  } catch (error) {
    return codedErrorResponse(error);
  }
  return await itemResponse(c, id);
});

// GET /api/items — newest first, filtered by state, needsOwner, source and a createdAt range
app.get("/api/items", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const needsOwner = c.req.query("needsOwner");
  const limit = c.req.query("limit");
  const parsedQuery = itemListQuerySchema.safeParse({
    state: nonEmptyString(c.req.query("state")),
    needsOwner: needsOwner === "true" ? true : needsOwner === "false" ? false : needsOwner,
    source: nonEmptyString(c.req.query("source")),
    kind: nonEmptyString(c.req.query("kind")),
    outcome: nonEmptyString(c.req.query("outcome")),
    alertId: nonEmptyString(c.req.query("alertId")),
    q: nonEmptyString(c.req.query("q")),
    from: parseOptionalQueryTimestamp(c.req.query("from")),
    to: parseOptionalQueryTimestamp(c.req.query("to")),
    limit: limit === undefined ? undefined : Number(limit),
    cursor: nonEmptyString(c.req.query("cursor")),
  });
  if (!parsedQuery.success) return jsonError(formatIssues(parsedQuery.error.issues));

  let page: { items: unknown[]; nextCursor?: string };
  try {
    page = await c.env.runQuery((internal as any).items.list, {
      ...parsedQuery.data,
      limit: parsedQuery.data.limit ?? ITEM_LIST_DEFAULT_LIMIT,
      timeZone: resolveRoundupTimeZone(),
    });
  } catch (error) {
    // A cursor from another query, or a corrupted one, cannot continue this list.
    if (parsedQuery.data.cursor) return jsonError("Invalid cursor");
    throw error;
  }
  return c.json(itemListResponseSchema.parse({ ok: true, count: page.items.length, ...page }));
});

// GET /api/items/stats — outcome mix, time to resolve, noise, repeats, daily volume and firing
app.get("/api/items/stats", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const timeZone = resolveRoundupTimeZone();
  const range = resolveItemStatsRange(
    {
      from: parseOptionalQueryTimestamp(c.req.query("from")),
      to: parseOptionalQueryTimestamp(c.req.query("to")),
    },
    Date.now(),
    timeZone,
  );
  const parsedRange = itemStatsQuerySchema.safeParse({
    ...range,
    source: nonEmptyString(c.req.query("source")),
    kind: nonEmptyString(c.req.query("kind")),
    outcome: nonEmptyString(c.req.query("outcome")),
  });
  if (!parsedRange.success) return jsonError(formatIssues(parsedRange.error.issues));

  const stats = await c.env.runQuery((internal as any).itemStats.stats, {
    ...parsedRange.data,
    timeZone,
  });
  return c.json(itemStatsResponseSchema.parse({ ok: true, ...stats }));
});

// GET /api/items/inbox — what needs the owner, what Hermes is on, and what resolved today
app.get("/api/items/inbox", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const inbox = await c.env.runQuery((internal as any).items.inbox, { now: Date.now() });
  return c.json(
    itemInboxResponseSchema.parse({
      ok: true,
      counts: {
        needsYou: inbox.needsYou.length,
        withHermes: inbox.withHermes.length,
        upcoming: inbox.upcoming.length,
        handled: inbox.handled.length,
      },
      ...inbox,
    }),
  );
});

// GET /api/items/sources — every source with an item, for the history filter
app.get("/api/items/sources", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const sources = await c.env.runQuery((internal as any).items.sources, {});
  return c.json(itemSourcesResponseSchema.parse({ ok: true, sources }));
});

// GET /api/items/:id — the item and its timeline
app.get("/api/items/:id", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const result = await c.env.runQuery((internal as any).items.get, { id: c.req.param("id") });
  if (!result) return jsonError("Item not found", 404);
  return c.json(itemGetResponseSchema.parse({ ok: true, ...result }));
});

// --- Sources --------------------------------------------------------------------------

async function issueSourceToken() {
  const token = `${SOURCE_TOKEN_PREFIX}${randomBase64Url()}`;
  return { token, tokenHash: await sha256Hex(token) };
}

// POST /api/sources — register a source; its token is returned this once
app.post("/api/sources", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const parsed = sourceCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  const { token, tokenHash } = await issueSourceToken();
  try {
    const source = await c.env.runMutation((internal as any).sources.create, {
      ...parsed.data,
      tokenHash,
      now: Date.now(),
    });
    return c.json(sourceTokenResponseSchema.parse({ ok: true, source, token }));
  } catch (error) {
    return codedErrorResponse(error);
  }
});

// GET /api/sources — every source, without token digests
app.get("/api/sources", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const sources = await c.env.runQuery((internal as any).sources.list, {});
  return c.json(sourceListResponseSchema.parse({ ok: true, sources }));
});

// POST /api/sources/:slug/token — issue a new token; the old one stops working at once
app.post("/api/sources/:slug/token", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const { token, tokenHash } = await issueSourceToken();
  try {
    const source = await c.env.runMutation((internal as any).sources.rotateToken, {
      slug: c.req.param("slug"),
      tokenHash,
      now: Date.now(),
    });
    return c.json(sourceTokenResponseSchema.parse({ ok: true, source, token }));
  } catch (error) {
    return codedErrorResponse(error);
  }
});

// PATCH /api/sources/:slug — rename, enable or disable a source
app.patch("/api/sources/:slug", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const parsed = sourcePatchRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  try {
    const source = await c.env.runMutation((internal as any).sources.patch, {
      ...parsed.data,
      slug: c.req.param("slug"),
      now: Date.now(),
    });
    return c.json(sourceResponseSchema.parse({ ok: true, source }));
  } catch (error) {
    return codedErrorResponse(error);
  }
});

// PUT /api/sources/:slug/icon — a square PNG body replaces the source's icon
app.put("/api/sources/:slug/icon", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const slug = c.req.param("slug");
  if (!(await c.env.runQuery((internal as any).sources.getBySlug, { slug }))) {
    return jsonError("Source not found", 404);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const invalid = sourceIconError(bytes);
  if (invalid) return jsonError(invalid);

  const storageId = await c.env.storage.store(new Blob([bytes], { type: "image/png" }));
  const source = await c.env.runMutation((internal as any).sources.setIcon, {
    slug,
    storageId,
    now: Date.now(),
  });
  if (!source) return jsonError("Source not found", 404);
  return c.json(sourceResponseSchema.parse({ ok: true, source }));
});

// GET /api/sources/:slug/icon — public: the Notification Service Extension has no session
app.get("/api/sources/:slug/icon", async (c) => {
  const storageId = await c.env.runQuery((internal as any).sources.iconStorageId, {
    slug: c.req.param("slug"),
  });
  const icon = storageId ? await c.env.storage.get(storageId) : null;
  if (!icon) return jsonError("Icon not found", 404);

  const etag = `"${storageId}"`;
  const headers = { "cache-control": "public, max-age=86400", etag };
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(icon, { headers: { ...headers, "content-type": "image/png" } });
});

// GET /api/me/snooze-options — the snooze picker's preset times in the device's time zone
app.get("/api/me/snooze-options", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;
  const ownerError = requireCowtailOwner(auth);
  if (ownerError) return ownerError;

  const parsed = snoozeOptionsQuerySchema.safeParse({ timeZone: c.req.query("timeZone") });
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));
  return c.json(
    snoozeOptionsResponseSchema.parse({
      ok: true,
      options: snoozeOptions(Date.now(), parsed.data.timeZone),
    }),
  );
});

// POST /api/me/items/:id/actions — the owner acks, snoozes or answers an item
app.post("/api/me/items/:id/actions", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;
  const ownerError = requireCowtailOwner(auth);
  if (ownerError) return ownerError;

  const parsed = itemActionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));
  const authenticated = c.req.query("authenticated");
  const query = itemActionQuerySchema.safeParse({
    authenticated:
      authenticated === "true" ? true : authenticated === "false" ? false : authenticated,
  });
  if (!query.success) return jsonError(formatIssues(query.error.issues));

  const id = c.req.param("id");
  try {
    await c.env.runMutation((internal as any).items.applyAction, {
      id,
      action: parsed.data,
      actor: auth.userId,
      now: Date.now(),
      authenticated: query.data.authenticated,
    });
  } catch (error) {
    return codedErrorResponse(error);
  }
  return await itemResponse(c, id);
});

// --- Hermes platform ------------------------------------------------------------------

const HERMES_RESPONSE_LEASE_SECONDS = 60;

// POST /api/hermes/responses/claim — lease the oldest owner answer waiting for Hermes
app.post("/api/hermes/responses/claim", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const parsed = hermesResponseClaimRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  const response = await c.env.runMutation((internal as any).hermes.claimResponse, {
    workerId: parsed.data.workerId ?? "hermes-default-gateway",
    claimToken: generateClaimToken(),
    leaseSeconds: parsed.data.leaseSeconds ?? HERMES_RESPONSE_LEASE_SECONDS,
    now: Date.now(),
  });
  return c.json(
    hermesResponseClaimResponseSchema.parse({ ok: true, response: response ?? undefined }),
  );
});

// POST /api/hermes/responses/:id/complete — Hermes applied the answer; the item resolves
app.post("/api/hermes/responses/:id/complete", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const parsed = hermesResponseCompleteRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  try {
    await c.env.runMutation((internal as any).hermes.completeResponse, {
      id: c.req.param("id"),
      ...parsed.data,
      now: Date.now(),
    });
  } catch (error) {
    return codedErrorResponse(error);
  }
  return c.json(okResponseSchema.parse({ ok: true }));
});

// POST /api/hermes/responses/:id/fail — Hermes no longer holds the request; the item expires
app.post("/api/hermes/responses/:id/fail", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const parsed = hermesResponseFailRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  try {
    await c.env.runMutation((internal as any).hermes.failResponse, {
      id: c.req.param("id"),
      ...parsed.data,
      now: Date.now(),
    });
  } catch (error) {
    return codedErrorResponse(error);
  }
  return c.json(okResponseSchema.parse({ ok: true }));
});

// POST /api/hermes/heartbeat — Hermes is alive; store what it is doing
app.post("/api/hermes/heartbeat", async (c) => {
  const authError = requireWorkerAuth(c);
  if (authError) return authError;

  const parsed = hermesSnapshotSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError(formatIssues(parsed.error.issues));

  await c.env.runMutation((internal as any).hermes.recordHeartbeat, {
    snapshot: parsed.data,
    now: Date.now(),
  });
  return c.json(okResponseSchema.parse({ ok: true }));
});

// GET /api/hermes/status — the latest heartbeat, how alive Hermes looks, and recent answers
app.get("/api/hermes/status", async (c) => {
  const authError = await requireItemReader(c);
  if (authError) return authError;

  const reply = await c.env.runQuery((internal as any).hermes.getStatus, { now: Date.now() });
  return c.json(hermesStatusResponseSchema.parse({ ok: true, ...reply }));
});

// POST /api/auth/session — exchange a fresh Apple identity token for an app session
app.post("/api/auth/session", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = authSessionCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  let userId: string;
  try {
    userId = await verifyAppleIdentityToken(parsed.data.identityToken);
  } catch (error) {
    if (error instanceof AppleIdentityVerificationError) {
      return jsonError(error.message, error.statusCode);
    }

    const message =
      error instanceof Error ? error.message : "Apple identity token verification failed";
    return jsonError(message, 500);
  }

  return c.json(
    authSessionCreateResponseSchema.parse({
      ok: true,
      session: await issueSession(c.env, userId),
    }),
  );
});

// GET /api/auth/providers — the sign-in methods clients should offer
app.get("/api/auth/providers", (c) => {
  let oidc;
  try {
    oidc = oidcConfig();
  } catch {
    oidc = null;
  }

  return c.json(
    authProvidersResponseSchema.parse({
      apple: true,
      ...(oidc ? { oidc: { name: oidc.displayName } } : {}),
    }),
  );
});

function textPage(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function oidcRedirectUri(): string {
  return `${cowtailWebOrigin()}/actions/api/auth/oidc/callback`;
}

// Off (404), partial (500) or the configuration. `respond` shapes the error for a browser
// page or a JSON client.
function requireOidc(respond: (message: string, status: number) => Response) {
  try {
    const config = oidcConfig();
    return config ? { config } : { error: respond("Not found", 404) };
  } catch (error) {
    if (error instanceof OidcError) {
      return { error: respond(error.message, error.statusCode) };
    }
    throw error;
  }
}

const HANDOFF_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// GET /api/auth/oidc/start — begin an OIDC sign-in for the browser or the iOS app
app.get("/api/auth/oidc/start", async (c) => {
  const oidc = requireOidc(textPage);
  if ("error" in oidc) return oidc.error;

  const client = c.req.query("client");
  const handoffChallenge = c.req.query("handoff_challenge");
  if (client !== "web" && client !== "ios") {
    return textPage("client must be web or ios", 400);
  }
  if (client === "ios" && !HANDOFF_CHALLENGE_PATTERN.test(handoffChallenge ?? "")) {
    return textPage("client=ios requires a base64url S256 handoff_challenge", 400);
  }

  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const codeVerifier = randomBase64Url();
  const login = await c.env.runMutation(internal.authSessions.createOidcLogin, {
    stateHash: await sha256Hex(state),
    codeVerifier,
    nonce,
    client,
    handoffChallenge: client === "ios" ? handoffChallenge : undefined,
  });
  if (!login.admitted) {
    return textPage("Too many sign-ins in progress. Try again in a few minutes.", 429);
  }

  try {
    const discovery = await fetchOidcDiscovery(oidc.config);
    const authorize = new URL(discovery.authorizationEndpoint);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: oidc.config.clientId,
      redirect_uri: oidcRedirectUri(),
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: await pkceChallenge(codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return c.redirect(authorize.toString(), 302);
  } catch (error) {
    if (error instanceof OidcError) return textPage(error.message, error.statusCode);
    throw error;
  }
});

// GET /api/auth/oidc/callback — the provider's redirect back after the user signs in
app.get("/api/auth/oidc/callback", async (c) => {
  const oidc = requireOidc(textPage);
  if ("error" in oidc) return oidc.error;
  const ownerUserId = cowtailOwnerUserId();
  if (!ownerUserId) {
    return textPage("Cowtail owner user ID is not configured", 500);
  }

  const code = nonEmptyString(c.req.query("code"));
  const state = nonEmptyString(c.req.query("state"));
  if (!code || !state) {
    return textPage("Sign-in failed: the provider returned no code or state", 400);
  }

  const login = await c.env.runMutation(internal.authSessions.consumeOidcLoginByState, {
    stateHash: await sha256Hex(state),
  });
  if (!login) {
    return textPage("Sign-in expired or was already used. Start again.", 400);
  }

  let subject: string;
  try {
    const discovery = await fetchOidcDiscovery(oidc.config);
    const idToken = await exchangeOidcCode(oidc.config, discovery, {
      code,
      codeVerifier: login.codeVerifier,
      redirectUri: oidcRedirectUri(),
    });
    subject = await verifyOidcIdToken(oidc.config, discovery, { idToken, nonce: login.nonce });
  } catch (error) {
    if (error instanceof OidcError) return textPage(error.message, error.statusCode);
    throw error;
  }

  if (subject !== oidc.config.ownerSubject) {
    return textPage("This account is not allowed to sign in to Cowtail.", 403);
  }

  if (login.client === "ios") {
    const handoffCode = createOpaqueToken();
    await c.env.runMutation(internal.authSessions.storeOidcHandoffCode, {
      id: login.id,
      handoffCodeHash: await sha256Hex(handoffCode),
    });
    return c.redirect(`cowtail://auth/callback?code=${encodeURIComponent(handoffCode)}`, 302);
  }

  const session = await issueSession(c.env, ownerUserId);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: AUTH_SESSION_TTL_MS / 1000,
  });
  return c.redirect("/", 302);
});

// POST /api/auth/oidc/handoff — the iOS app trades its hand-off code and PKCE verifier for a session
app.post("/api/auth/oidc/handoff", async (c) => {
  const oidc = requireOidc((message, status) => jsonError(message, status));
  if ("error" in oidc) return oidc.error;
  const ownerUserId = cowtailOwnerUserId();
  if (!ownerUserId) {
    return jsonError("Cowtail owner user ID is not configured", 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = authOidcHandoffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  const redemption = await c.env.runMutation(internal.authSessions.redeemOidcHandoffCode, {
    handoffCodeHash: await sha256Hex(parsed.data.code),
    handoffChallenge: await pkceChallenge(parsed.data.verifier),
  });
  if (!redemption.ok) {
    return jsonError("Invalid or expired hand-off code", 401);
  }

  return c.json(
    authOidcHandoffResponseSchema.parse({
      ok: true,
      session: await issueSession(c.env, ownerUserId),
    }),
  );
});

// POST /api/auth/logout — revoke the current bearer or cookie session and clear the cookie
app.post("/api/auth/logout", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;

  await c.env.runMutation(internal.authSessions.revokeSession, { id: auth.session._id });
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
  return c.json(authLogoutResponseSchema.parse({ ok: true }));
});

// POST /api/push/register — register or refresh an iOS device token
app.post("/api/push/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = pushRegisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  const identityToken = nonEmptyString(parsed.data.identityToken);
  if (!identityToken) {
    return jsonError("identityToken and deviceToken are required");
  }

  const deviceToken = nonEmptyString(parsed.data.deviceToken);
  if (!deviceToken) {
    return jsonError("identityToken and deviceToken are required");
  }

  let userId: string;
  try {
    userId = await verifyAppleIdentityToken(identityToken);
  } catch (error) {
    if (error instanceof AppleIdentityVerificationError) {
      return jsonError(error.message, error.statusCode);
    }

    const message =
      error instanceof Error ? error.message : "Apple identity token verification failed";
    return jsonError(message, 500);
  }

  const ctx = c.env;
  const result = await ctx.runMutation(internal.push.upsertDeviceRegistration, {
    userId,
    deviceToken: deviceToken.trim(),
    platform: nonEmptyString(parsed.data.platform) ?? "ios",
    environment: parsed.data.environment ?? configuredApnsEnvironment(),
    enabled: true,
    deviceName: nonEmptyString(parsed.data.deviceName),
    lastSeenAt: Date.now(),
  });

  return c.json(pushRegisterResponseSchema.parse({ ok: true, ...result }));
});

// POST /api/push/unregister — disable a device token without deleting history
app.post("/api/push/unregister", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = pushUnregisterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  let userId: string;
  try {
    userId = await verifyAppleIdentityToken(parsed.data.identityToken);
  } catch (error) {
    if (error instanceof AppleIdentityVerificationError) {
      return jsonError(error.message, error.statusCode);
    }

    const message =
      error instanceof Error ? error.message : "Apple identity token verification failed";
    return jsonError(message, 500);
  }

  const ctx = c.env;
  const result = await ctx.runMutation(internal.push.disableDeviceRegistrationByToken, {
    userId,
    deviceToken: parsed.data.deviceToken.trim(),
  });

  return c.json(pushUnregisterResponseSchema.parse(result));
});

// GET /api/me/notification-preferences — account-scoped notification preferences
app.get("/api/me/notification-preferences", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;

  const { dailyRoundupEnabled, quietHours, urgencyOverrides, requireAuthForApprovals } =
    await c.env.runQuery(internal.notificationPreferences.getEffectiveForUser, {
      userId: auth.userId,
    });

  return c.json(
    preferencesResponse({
      dailyRoundupEnabled,
      quietHours,
      urgencyOverrides,
      requireAuthForApprovals,
    }),
  );
});

// Overrides show by key: a source before its `source:kind` refinements.
function preferencesResponse(preferences: NotificationPreferences) {
  return notificationPreferencesResponseSchema.parse({
    ok: true,
    preferences,
    urgencyOverrideOrder: Object.keys(preferences.urgencyOverrides).sort(),
  });
}

// PUT /api/me/notification-preferences — update account-scoped notification preferences
app.put("/api/me/notification-preferences", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = notificationPreferencesUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  const preferences = await c.env.runMutation(internal.notificationPreferences.upsertForUser, {
    userId: auth.userId,
    ...parsed.data,
  });

  return c.json(preferencesResponse(preferences));
});

// GET /api/me/devices — the signed-in account's enabled push devices
app.get("/api/me/devices", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;

  const devices = await c.env.runQuery(internal.push.listEnabledDevicesForUser, {
    userId: auth.userId,
  });
  return c.json(
    userDevicesResponseSchema.parse({
      ok: true,
      userId: auth.userId,
      count: devices.length,
      devices: devices.map((device: any) => mapUserDevice(device as any)),
    }),
  );
});

// GET /api/me/openclaw-preferences — account-scoped OpenClaw preferences
app.get("/api/me/openclaw-preferences", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;

  const preferences = await c.env.runQuery(internal.openclawPreferences.getEffectiveForUser, {
    userId: auth.userId,
  });

  return c.json(
    openclawDisplayPreferencesResponseSchema.parse({
      ok: true,
      preferences: {
        displayName: preferences.displayName,
      },
    }),
  );
});

// PUT /api/me/openclaw-preferences — update account-scoped OpenClaw preferences
app.put("/api/me/openclaw-preferences", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = openclawDisplayPreferencesUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  await c.env.runMutation(internal.openclawPreferences.upsertForUser, {
    userId: auth.userId,
    displayName: parsed.data.displayName,
  });

  return c.json(
    openclawDisplayPreferencesResponseSchema.parse({
      ok: true,
      preferences: parsed.data,
    }),
  );
});

// GET /api/openclaw/threads — app-session-authenticated global OpenClaw thread list.
// OpenClaw is single-owner/multi-device, so only the configured owner can read shared account history.
app.get("/api/openclaw/threads", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;
  const ownerError = requireOpenClawOwner(auth);
  if (ownerError) return ownerError;

  const parsedLimit = parseOpenClawListLimit(c.req.query("limit"));
  if ("error" in parsedLimit) {
    return jsonError(parsedLimit.error, 400);
  }

  const threads = await c.env.runQuery(internal.openclaw.listThreadsForApp, {
    limit: parsedLimit.limit,
  });

  return c.json(
    openclawThreadListResponseSchema.parse({
      ok: true,
      count: threads.length,
      threads,
    }),
  );
});

// GET /api/openclaw/threads/:threadId/messages — app-session-authenticated global thread history.
app.get("/api/openclaw/threads/:threadId/messages", async (c) => {
  const auth = await requireAppSession(c);
  if ("error" in auth) return auth.error;
  const ownerError = requireOpenClawOwner(auth);
  if (ownerError) return ownerError;

  const parsedLimit = parseOpenClawListLimit(c.req.query("limit"));
  if ("error" in parsedLimit) {
    return jsonError(parsedLimit.error, 400);
  }

  let messages;
  try {
    messages = await c.env.runQuery(internal.openclaw.listMessagesForApp, {
      threadId: c.req.param("threadId") as Id<"openclawThreads">,
      limit: parsedLimit.limit,
    });
  } catch (error) {
    if (isConvexArgumentValidationError(error)) {
      return jsonError("Invalid threadId", 400);
    }

    throw error;
  }

  return c.json(
    openclawMessageWithActionsListResponseSchema.parse({
      ok: true,
      count: messages.length,
      messages,
    }),
  );
});

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

  const normalizedData = normalizePushDataForSend(parsed.data.data, extractAlertId(body));
  if (!normalizedData.ok) {
    return jsonError(normalizedData.error);
  }

  const result = await sendPushToUser(c.env, {
    userId: parsed.data.userId,
    title: parsed.data.title,
    body: parsed.data.body,
    data: normalizedData.data,
  });

  return c.json(pushResultSchema.parse(result));
});

async function handleRoundupTest(c: RouteContext) {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return jsonError("Invalid JSON body");
  }

  const parsed = roundupTestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatIssues(parsed.error.issues), 400);
  }

  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return jsonError("from must be less than or equal to to", 400);
  }

  try {
    const result = await c.env.runAction(internal.roundupActions.sendTestDailyRoundup, {
      userId: parsed.data.userId,
      roundupFrom: parsed.data.from,
      roundupTo: parsed.data.to,
    });

    return c.json(roundupTestResultSchema.parse(result));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 400);
  }
}

// POST /api/roundup/test — authenticated helper for manual roundup sends
app.post("/api/roundup/test", handleRoundupTest);

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

  const normalizedData = normalizePushDataForSend(parsed.data.data, extractAlertId(body));
  if (!normalizedData.ok) {
    return jsonError(normalizedData.error);
  }

  const result = await sendPushToUser(c.env, {
    userId: parsed.data.userId,
    title: parsed.data.title ?? "Cowtail test notification",
    body: parsed.data.body ?? "Push delivery from Cowtail is working.",
    data: {
      test: true,
      ...normalizedData.data,
    },
  });

  return c.json(pushResultSchema.parse(result));
});

// GET /api/users — list current users with enabled push device counts
app.get("/api/users", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const users = await c.env.runQuery(internal.push.listCurrentUsers, {});
  return c.json(
    usersListResponseSchema.parse({
      ok: true,
      count: users.length,
      users,
    }),
  );
});

// GET /api/users/:userId/devices — list enabled devices for a user
app.get("/api/users/:userId/devices", async (c) => {
  const authError = requireServiceAuth(c);
  if (authError) return authError;

  const userId = c.req.param("userId");
  const devices = await c.env.runQuery(internal.push.listEnabledDevicesForUser, { userId });

  return c.json(
    userDevicesResponseSchema.parse({
      ok: true,
      userId,
      count: devices.length,
      devices: devices.map((device: any) => mapUserDevice(device as any)),
    }),
  );
});

// GET /api/health — aggregated cluster health for native clients and web fallback
app.get("/api/health", async (c) => {
  try {
    const [cluster, alertPipeline] = await Promise.all([
      fetchClusterHealth(),
      c.env.runQuery((internal as any).pipelineStatus.get, { now: Date.now() }),
    ]);
    return c.json(healthResponseSchema.parse({ ...cluster, alertPipeline }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch cluster health";
    return jsonError(message, 502);
  }
});

export default new HttpRouterWithHono(app);
