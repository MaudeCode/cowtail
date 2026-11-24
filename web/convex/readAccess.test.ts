import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { newBackend, request, seedSession, stubEnv } from "../test/convexHarness";

const SERVICE = "service-token";
const OWNER = "owner-user";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 24, 12, 0, 0) });
  stubEnv({ PUSH_API_BEARER_TOKEN: SERVICE, COWTAIL_OWNER_USER_ID: OWNER });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const READ_ROUTES = [
  "/api/items",
  "/api/items/inbox",
  "/api/items/sources",
  "/api/items/stats",
  "/api/items/missing",
  "/api/alerts",
  "/api/alerts/missing",
  "/api/fixes",
  "/api/fixes/missing",
];

test("item, alert and fix reads refuse a caller with neither the service token nor a session", async () => {
  const t = newBackend();

  const statuses = await Promise.all(
    READ_ROUTES.map(async (path) => [path, (await request(t, path)).status]),
  );

  expect(statuses).toEqual(READ_ROUTES.map((path) => [path, 401]));
});

test("alert and fix lists answer the CLI's service token and the owner's session", async () => {
  const t = newBackend();
  const owner = await seedSession(t, OWNER);

  const statuses = [
    (await request(t, "/api/alerts", { bearer: SERVICE })).status,
    (await request(t, "/api/fixes", { bearer: owner })).status,
  ];

  expect(statuses).toEqual([200, 200]);
});
