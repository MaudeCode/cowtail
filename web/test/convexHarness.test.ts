import { notificationPreferencesResponseSchema } from "@maudecode/cowtail-protocol";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import { advance, newBackend, request, seedSession, stubEnv } from "./convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

// The generated api predates these modules; Convex resolves them by name.
const enqueueDelivery = makeFunctionReference<
  "mutation",
  { jobId: Id<"investigationJobs">; now: number },
  Id<"jobDeliveries">
>("jobDeliveries:enqueue");
const deliverOne = makeFunctionReference<
  "action",
  { deliveryId: Id<"jobDeliveries"> },
  { delivered: boolean; statusCode?: number }
>("jobDeliveryActions:deliverOne");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a roundup lease is claimed once, and again only after it expires", async () => {
  const t = newBackend();
  const lease = { userId: "user-1", roundupKey: "2026-11-24" };
  await t.mutation(internal.notificationPreferences.upsertForUser, {
    userId: lease.userId,
    dailyRoundupEnabled: true,
  });

  const claim = () => t.mutation(internal.notificationPreferences.claimRoundupKey, lease);
  expect(await claim()).toEqual({ claimed: true });
  expect(await claim()).toEqual({ claimed: false });

  await advance(t, 15 * 60_000 - 1);
  expect(await claim()).toEqual({ claimed: false });

  await advance(t, 1);
  expect(await claim()).toEqual({ claimed: true });
});

test("notification preferences need a session", async () => {
  const t = newBackend();

  const anonymous = await request(t, "/api/me/notification-preferences");
  expect(anonymous.status).toBe(401);

  const bearer = await seedSession(t, "user-1");
  const signedIn = await request(t, "/api/me/notification-preferences", { bearer });
  expect(signedIn.status).toBe(200);
  expect(notificationPreferencesResponseSchema.parse(signedIn.json)).toEqual({
    ok: true,
    preferences: {
      dailyRoundupEnabled: false,
      quietHours: null,
      urgencyOverrides: {},
      requireAuthForApprovals: false,
    },
    urgencyOverrideOrder: [],
  });

  // The server orders the overrides: a source before its `source:kind` refinements.
  const saved = await request(t, "/api/me/notification-preferences", {
    method: "PUT",
    bearer,
    body: { urgencyOverrides: { "hermes:failure": "now", factory: "whenever", hermes: "today" } },
  });
  expect(notificationPreferencesResponseSchema.parse(saved.json).urgencyOverrideOrder).toEqual([
    "factory",
    "hermes",
    "hermes:failure",
  ]);
});

test("a failed Hermes delivery is retried when the clock reaches the retry cron", async () => {
  const t = newBackend();
  stubEnv({
    COWTAIL_HERMES_ALERT_JOB_WEBHOOK_URL: "https://hermes.test/alert-job",
    COWTAIL_HERMES_ALERT_JOB_WEBHOOK_TOKEN: "hermes-token",
  });
  const jobId = await t.run(async (ctx) => {
    const sourceEventId = await ctx.db.insert("alertmanagerEvents", {
      receivedAt: NOW,
      source: "alertmanager",
      status: "firing",
      groupLabels: {},
      commonLabels: {},
      commonAnnotations: {},
      rawPayload: {},
      payloadHash: "hash",
      createdAlertIds: [],
      createdJobIds: [],
      ingestStatus: "normalized",
    });
    const alertId = await ctx.db.insert("alerts", {
      timestamp: NOW,
      alertname: "KubePodCrashLooping",
      severity: "warning",
      namespace: "default",
      status: "firing",
      outcome: "pending",
      summary: "",
      action: "",
      messaged: false,
    });
    return await ctx.db.insert("investigationJobs", {
      alertId,
      sourceEventId,
      fingerprint: "fp",
      dedupeKey: "dedupe",
      status: "queued",
      priority: "normal",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: NOW,
      errorHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  const deliveryId = await t.mutation(enqueueDelivery, { jobId, now: NOW });
  let hermesUp = false;
  const hermes = vi.fn<typeof fetch>(async (url, init) => {
    if (url !== "https://hermes.test/alert-job") throw new Error(`unexpected fetch ${url}`);
    if (!hermesUp) return Response.json({ status: "busy" }, { status: 503 });
    const requestId = new Headers(init?.headers).get("x-request-id");
    return Response.json({ status: "accepted", delivery_id: requestId }, { status: 202 });
  });
  vi.stubGlobal("fetch", hermes);

  expect(await t.action(deliverOne, { deliveryId })).toMatchObject({
    delivered: false,
    statusCode: 503,
  });

  hermesUp = true;
  await advance(t, 60_000);

  expect(hermes).toHaveBeenCalledTimes(2);
  const [url, init] = hermes.mock.calls[1];
  expect(url).toBe("https://hermes.test/alert-job");
  expect(init?.headers).toMatchObject({
    authorization: "Bearer hermes-token",
    "x-request-id": deliveryId,
  });
  expect(await t.run((ctx) => ctx.db.get(deliveryId))).toMatchObject({
    status: "delivered",
    attempts: 2,
  });
});
