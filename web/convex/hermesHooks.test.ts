import { createHmac, randomUUID } from "node:crypto";

import { itemListResponseSchema } from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { type Backend, advance, newBackend, request, rows, stubEnv } from "../test/convexHarness";

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const SERVICE = "service-token";
const SECRET = "hermes-hook-secret";
const MINUTE = 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({ PUSH_API_BEARER_TOKEN: SERVICE, COWTAIL_HERMES_HOOK_SECRET: SECRET });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// The body Hermes's outbound webhook posts, as agent/outbound_webhooks.py builds it.
function hook(event: string, extra: Record<string, unknown>, deliveryId = randomUUID()) {
  return {
    hook_event_name: event,
    profile: "default",
    tool_name: null,
    tool_input: null,
    session_id: "sess_1",
    cwd: "/srv/hermes",
    extra,
    delivery_id: deliveryId,
    timestamp: new Date(Date.now()).toISOString(),
  };
}

const blocked = (taskId = "t_42") =>
  hook("kanban_task_blocked", {
    task_id: taskId,
    board: "main",
    assignee: "coder",
    run_id: 7,
    profile_name: "default",
    reason: "Needs the staging database password",
  });

const apiError = (status = 429) =>
  hook("api_request_error", {
    provider: "openrouter",
    model: "big-model",
    status_code: status,
    error: { type: "RateLimitError", message: "Too many requests" },
  });

async function send(
  t: Backend,
  payload: unknown,
  { secret = SECRET, body }: { secret?: string | null; body?: string } = {},
) {
  const signed = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) {
    const digest = createHmac("sha256", secret).update(signed).digest("hex");
    headers["x-hermes-signature-256"] = `sha256=${digest}`;
  }
  const response = await t.fetch("/api/hermes/hooks", {
    method: "POST",
    headers,
    body: body ?? signed,
  });
  return response.status;
}

async function listItems(t: Backend) {
  const response = await request(t, "/api/items", { bearer: SERVICE });
  expect(response.status).toBe(200);
  return itemListResponseSchema.parse(response.json).items;
}

describe("Hermes hook signatures", () => {
  test("a wrong secret, a tampered body or a missing signature is refused and stores nothing", async () => {
    const t = newBackend();
    const payload = blocked();

    expect(await send(t, payload, { secret: "other-secret" })).toBe(401);
    expect(await send(t, payload, { body: JSON.stringify(blocked("t_43")) })).toBe(401);
    expect(await send(t, payload, { secret: null })).toBe(401);

    expect(await listItems(t)).toEqual([]);
  });

  test("a redelivery of the same delivery_id answers 200 and stores nothing new", async () => {
    const t = newBackend();
    const payload = apiError();

    expect(await send(t, payload)).toBe(200);
    expect(await send(t, payload)).toBe(200);

    const items = await listItems(t);
    expect(items).toHaveLength(1);
    expect(items[0].occurrenceCount).toBe(1);
  });
});

describe("Hermes hook deliveries", () => {
  test("the hourly prune forgets deliveries older than a day", async () => {
    const t = newBackend();
    expect(await send(t, apiError(500))).toBe(200);
    await advance(t, 23 * 60 * MINUTE);
    expect(await send(t, apiError(503))).toBe(200);

    await advance(t, 2 * 60 * MINUTE);

    expect((await rows(t, "hermesHookDeliveries")).map((row) => row.receivedAt)).toEqual([
      NOW + 23 * 60 * MINUTE,
    ]);
  });
});

describe("Hermes hook events", () => {
  test("a blocked kanban task becomes a question for today", async () => {
    const t = newBackend();

    expect(await send(t, blocked())).toBe(200);

    expect(await listItems(t)).toEqual([
      expect.objectContaining({
        source: "hermes",
        kind: "question",
        urgency: "today",
        state: "open",
        needsOwner: true,
        body: "Needs the staging database password",
        dedupeKey: "hermes-kanban:t_42",
      }),
    ]);
  });

  test("a rate-limited worker exit becomes a failure for today, keyed by profile", async () => {
    const t = newBackend();
    const exited = hook("on_kanban_worker_exited", {
      task_id: "t_42",
      profile_name: "coder",
      exit_kind: "rate_limited",
      exit_code: 75,
    });

    expect(await send(t, exited)).toBe(200);

    expect(await listItems(t)).toEqual([
      expect.objectContaining({
        source: "hermes",
        kind: "failure",
        urgency: "today",
        dedupeKey: "hermes-ratelimit:coder",
      }),
    ]);
  });

  test("other exits and unknown events answer 200 and store nothing", async () => {
    const t = newBackend();

    for (const payload of [
      hook("on_kanban_worker_exited", { task_id: "t_42", exit_kind: "clean_exit" }),
      hook("on_session_end", {}),
      hook("kanban_task_completed", { task_id: "t_42", summary: "Done" }),
    ]) {
      expect(await send(t, payload)).toBe(200);
    }

    expect(await listItems(t)).toEqual([]);
  });

  test("a provider error becomes a failure for whenever, and a repeat counts into it", async () => {
    const t = newBackend();

    expect(await send(t, apiError())).toBe(200);
    expect(await send(t, apiError())).toBe(200);

    expect(await listItems(t)).toEqual([
      expect.objectContaining({
        source: "hermes",
        kind: "failure",
        urgency: "whenever",
        dedupeKey: "hermes-api:openrouter:429",
        occurrenceCount: 2,
      }),
    ]);
  });

  test("the tenth provider error within an hour raises urgency to today, once", async () => {
    const t = newBackend();
    const urgencyAfterEachError: string[] = [];
    const sendError = async () => {
      expect(await send(t, apiError())).toBe(200);
      const [item] = await listItems(t);
      urgencyAfterEachError.push(item.urgency);
    };

    // Nine errors, then an hour passes: the tenth error overall is the first in its hour.
    for (let i = 0; i < 9; i += 1) await sendError();
    vi.advanceTimersByTime(61 * MINUTE);
    for (let i = 0; i < 11; i += 1) {
      await sendError();
      vi.advanceTimersByTime(MINUTE);
    }

    expect(urgencyAfterEachError).toEqual([
      ...Array(9 + 9).fill("whenever"),
      ...Array(2).fill("today"),
    ]);
  });
});
