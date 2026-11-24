import { expect, test } from "vitest";
import { stubApi } from "./api";

test("stubApi answers listed routes, 404s the rest, and records every call", async () => {
  const { calls } = stubApi({ "POST /api/alerts": { status: 201, body: { id: "a1" } } });

  const listed = await fetch("/api/alerts", { method: "POST", body: JSON.stringify({ n: 1 }) });
  const unlisted = await fetch("/api/missing");

  expect([listed.status, await listed.json()]).toEqual([201, { id: "a1" }]);
  expect(unlisted.status).toBe(404);
  expect(calls).toEqual([
    { method: "POST", path: "/api/alerts", body: { n: 1 } },
    { method: "GET", path: "/api/missing", body: undefined },
  ]);
});
