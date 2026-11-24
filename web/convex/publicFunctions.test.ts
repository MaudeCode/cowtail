import { expect, test } from "vitest";

const modules = import.meta.glob(["./*.ts", "!./*.test.ts"], { eager: true });

// Item, alert and fix data leaves the backend only through authenticated HTTP routes. A
// public query is callable by anyone who knows the deployment URL, so only modules that
// guard their own reads may export one.
const MODULES_WITH_PUBLIC_QUERIES = new Set(["authSessions", "openclaw"]);

test("no public Convex query outside the self-guarded modules", () => {
  const publicQueries = Object.entries(modules).flatMap(([path, exports]) =>
    Object.entries(exports as Record<string, { isQuery?: boolean; isPublic?: boolean }>)
      .filter(([, fn]) => fn?.isQuery && fn.isPublic)
      .map(([name]) => `${path.slice(2, -3)}.${name}`),
  );

  expect(publicQueries.length).toBeGreaterThan(0);
  expect(
    publicQueries.filter((name) => !MODULES_WITH_PUBLIC_QUERIES.has(name.split(".")[0])),
  ).toEqual([]);
});
