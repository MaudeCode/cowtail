import { itemStatsResponseSchema } from "@maudecode/cowtail-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import {
  type Backend,
  alertFields,
  newBackend,
  request,
  seedSession,
  stubEnv,
} from "../test/convexHarness";

// 07:00 on Tue 24 Nov in New York (UTC-5).
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const NY_MIDNIGHT_NOV_24 = Date.UTC(2026, 10, 24, 5, 0, 0);
const NY_MIDNIGHT_NOV_23 = Date.UTC(2026, 10, 23, 5, 0, 0);
const MINUTE = 60_000;
const SERVICE = "service-token";
const OWNER = "owner-user";

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  stubEnv({
    PUSH_API_BEARER_TOKEN: SERVICE,
    COWTAIL_OWNER_USER_ID: OWNER,
    DAILY_ROUNDUP_TIMEZONE: "America/New_York",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type ItemSeed = Partial<Omit<Doc<"items">, "_id" | "_creationTime">>;

// Stored items, written straight to the table as earlier writes left them.
async function seedItems(t: Backend, seeds: ItemSeed[]): Promise<Id<"items">[]> {
  return await t.run(async (ctx) => {
    const ids = [];
    for (const seed of seeds) {
      const createdAt = seed.createdAt ?? NOW - 60 * MINUTE;
      ids.push(
        await ctx.db.insert("items", {
          source: "hermes",
          kind: "failure",
          urgency: "today",
          state: "open",
          title: "Backup failed",
          body: "",
          links: [],
          context: {},
          occurrenceCount: 1,
          actions: [],
          updatedAt: seed.resolvedAt ?? createdAt,
          ...seed,
          createdAt,
        }),
      );
    }
    return ids;
  });
}

async function seedAlert(t: Backend, fields: Parameters<typeof alertFields>[0]) {
  return await t.run((ctx) => ctx.db.insert("alerts", alertFields(fields)));
}

async function stats(t: Backend, query = "") {
  const response = await request(t, `/api/items/stats${query}`, { bearer: SERVICE });
  expect(response.status).toBe(200);
  return itemStatsResponseSchema.parse(response.json);
}

const range = `?from=${NY_MIDNIGHT_NOV_23}&to=${NOW}`;

describe("item stats", () => {
  test("mixes resolved outcomes from the alert, the owner's call and the item's disposition", async () => {
    const t = newBackend();
    const fixedAlert = await seedAlert(t, { status: "resolved", outcome: "fixed" });
    const ownerNoise = await seedAlert(t, { outcome: "self-resolved", ownerDisposition: "noise" });
    const ownerEscalated = await seedAlert(t, { outcome: "fixed", ownerDisposition: "escalated" });
    const resolved = (
      minutes: number,
      { createdAt = NOW - 120 * MINUTE, ...seed }: ItemSeed,
    ): ItemSeed => ({
      state: "resolved",
      createdAt,
      resolvedAt: createdAt + minutes * MINUTE,
      ...seed,
    });
    await seedItems(t, [
      resolved(10, { kind: "alert", alertId: fixedAlert }),
      resolved(20, { kind: "alert", alertId: ownerNoise }),
      resolved(30, { kind: "alert", alertId: ownerEscalated }),
      resolved(5, { context: { disposition: "noise" } }),
      resolved(40, {}),
      resolved(1, { kind: "approval", context: { disposition: "self-resolved" } }),
      // Resolved before the range starts.
      resolved(1, { createdAt: NY_MIDNIGHT_NOV_23 - 60 * MINUTE }),
      { state: "acked" },
    ]);

    const result = await stats(t, range);

    expect(result.outcomeMix).toEqual({
      fixed: 1,
      "self-resolved": 1,
      noise: 2,
      escalated: 1,
      other: 1,
    });
    expect(result.resolvedCount).toBe(6);
    expect(result.noiseRate).toBeCloseTo(2 / 6);
    expect(result.timeToResolve).toEqual([
      { kind: "alert", count: 3, medianMs: 20 * MINUTE, p90Ms: 30 * MINUTE },
      { kind: "failure", count: 2, medianMs: 5 * MINUTE, p90Ms: 40 * MINUTE },
      { kind: "approval", count: 1, medianMs: 1 * MINUTE, p90Ms: 1 * MINUTE },
    ]);
  });

  test("a source, kind or outcome narrows the stats to the items History lists under it", async () => {
    const t = newBackend();
    const resolvedAt = NOW - 30 * MINUTE;
    await seedItems(t, [
      {
        state: "resolved",
        resolvedAt,
        kind: "alert",
        source: "alertmanager",
        context: { disposition: "noise" },
      },
      {
        state: "resolved",
        resolvedAt,
        kind: "failure",
        source: "cron",
        context: { disposition: "fixed" },
      },
      { state: "resolved", resolvedAt, kind: "failure", source: "hermes" },
    ]);

    const counts = async (filter: string) => {
      const result = await stats(t, `${range}&${filter}`);
      return [result.resolvedCount, result.createdCount, result.noiseRate];
    };

    expect(await counts("source=cron")).toEqual([1, 1, 0]);
    expect(await counts("kind=failure")).toEqual([2, 2, 0]);
    expect(await counts("outcome=noise")).toEqual([1, 1, 1]);
    expect(
      (await request(t, `/api/items/stats${range}&kind=nope`, { bearer: SERVICE })).status,
    ).toBe(400);
  });

  test("ranks repeat offenders by occurrences with their noise share and last sighting", async () => {
    const t = newBackend();
    const noisyAlert = (resolvedAt: number) =>
      seedAlert(t, { dedupeKey: "TargetDown|monitoring", ownerDisposition: "noise", resolvedAt });
    const first = await noisyAlert(NOW - 50 * MINUTE);
    const second = await noisyAlert(NOW - 30 * MINUTE);
    const third = await seedAlert(t, {
      dedupeKey: "TargetDown|monitoring",
      lastReceivedAt: NOW - 5 * MINUTE,
    });
    const [, , , backup] = await seedItems(t, [
      {
        kind: "alert",
        alertId: first,
        title: "TargetDown",
        state: "resolved",
        createdAt: NOW - 55 * MINUTE,
        resolvedAt: NOW - 50 * MINUTE,
      },
      {
        kind: "alert",
        alertId: second,
        title: "TargetDown",
        state: "resolved",
        createdAt: NOW - 35 * MINUTE,
        resolvedAt: NOW - 30 * MINUTE,
      },
      {
        kind: "alert",
        alertId: third,
        title: "TargetDown · node-exporter",
        createdAt: NOW - 6 * MINUTE,
        // The owner acked it after it last fired.
        state: "acked",
        updatedAt: NOW - MINUTE,
      },
      {
        dedupeKey: "backup",
        occurrenceCount: 2,
        createdAt: NOW - 90 * MINUTE,
        state: "acked",
        updatedAt: NOW - 2 * MINUTE,
      },
      { dedupeKey: "once", title: "Ran once" },
    ]);
    await t.run(async (ctx) => {
      const event = { itemId: backup, actor: "cron", payload: {} };
      await ctx.db.insert("itemEvents", { ...event, at: NOW - 20 * MINUTE, type: "repeated" });
      await ctx.db.insert("itemEvents", { ...event, at: NOW - 3 * MINUTE, type: "hermes_update" });
    });

    const result = await stats(t, range);

    expect(result.repeatOffenders).toEqual([
      {
        dedupeKey: "TargetDown|monitoring",
        title: "TargetDown · node-exporter",
        occurrenceCount: 3,
        noiseShare: 2 / 3,
        lastSeenAt: NOW - 5 * MINUTE,
      },
      {
        dedupeKey: "backup",
        title: "Backup failed",
        occurrenceCount: 2,
        noiseShare: 0,
        lastSeenAt: NOW - 20 * MINUTE,
      },
    ]);
  });

  test("buckets created items by source on the configured time zone's days", async () => {
    const t = newBackend();
    await seedItems(t, [
      { source: "alertmanager", createdAt: NY_MIDNIGHT_NOV_23 - 1 },
      { source: "alertmanager", createdAt: NY_MIDNIGHT_NOV_23 },
      { source: "alertmanager", createdAt: NY_MIDNIGHT_NOV_24 - 1 },
      { source: "hermes", createdAt: NY_MIDNIGHT_NOV_24 - 1 },
      { source: "cron", createdAt: NY_MIDNIGHT_NOV_24 },
      // A producer may name itself after an Object.prototype property.
      { source: "constructor", createdAt: NY_MIDNIGHT_NOV_24 },
    ]);

    const result = await stats(t, range);

    expect(result.createdCount).toBe(5);
    expect(result.dailyVolume).toEqual([
      { date: "2026-11-23", total: 3, bySource: { alertmanager: 2, hermes: 1 } },
      { date: "2026-11-24", total: 2, bySource: { cron: 1, constructor: 1 } },
    ]);
    // The chart stacks and lists sources by their total, most first.
    expect(result.volumeSources).toEqual(["alertmanager", "constructor", "cron", "hermes"]);
  });

  test("groups alerts still firing by namespace, acked and snoozed included", async () => {
    const t = newBackend();
    const media = await seedAlert(t, { namespace: "media" });
    const mediaAgain = await seedAlert(t, { namespace: "media" });
    const storage = await seedAlert(t, { namespace: "storage" });
    const closed = await seedAlert(t, { namespace: "edge", status: "resolved" });
    const [first, second, third] = await seedItems(t, [
      { kind: "alert", alertId: media, createdAt: NOW - 30 * 24 * 60 * MINUTE },
      { kind: "alert", alertId: mediaAgain, state: "acked" },
      { kind: "alert", alertId: storage, state: "snoozed" },
      { kind: "alert", alertId: closed, state: "resolved", resolvedAt: NOW - MINUTE },
      { kind: "failure" },
    ]);

    const result = await stats(t, range);

    expect(result.firingCount).toBe(3);
    expect(result.firingByNamespace).toEqual([
      { namespace: "media", count: 2, itemIds: [first, second] },
      { namespace: "storage", count: 1, itemIds: [third] },
    ]);
  });

  test("a range with no items reports zeros and empty lists", async () => {
    const t = newBackend();
    await seedItems(t, [{ createdAt: NOW - 10 * 24 * 60 * MINUTE }]);

    const result = await stats(t, range);

    expect(result).toEqual({
      ok: true,
      from: NY_MIDNIGHT_NOV_23,
      to: NOW,
      timeZone: "America/New_York",
      createdCount: 0,
      resolvedCount: 0,
      outcomeMix: { fixed: 0, "self-resolved": 0, noise: 0, escalated: 0, other: 0 },
      noiseRate: 0,
      timeToResolve: [],
      repeatOffenders: [],
      dailyVolume: [
        { date: "2026-11-23", total: 0, bySource: {} },
        { date: "2026-11-24", total: 0, bySource: {} },
      ],
      volumeSources: [],
      firingCount: 0,
      firingByNamespace: [],
    });
  });

  test("without a range, covers the last 7 local days, today included", async () => {
    const t = newBackend();
    const sevenDaysBack = Date.UTC(2026, 10, 18, 5, 0, 0);
    await seedItems(t, [{ createdAt: sevenDaysBack - 1 }, { createdAt: sevenDaysBack }]);

    const result = await stats(t);

    expect(result).toMatchObject({ from: sevenDaysBack, to: NOW, createdCount: 1 });
    expect(result.dailyVolume.map((day) => day.date)).toEqual([
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
    ]);
  });

  test("refuses callers without a service token or the owner's session, and bad ranges", async () => {
    const t = newBackend();
    const stranger = await seedSession(t, "someone-else");
    const owner = await seedSession(t, OWNER);
    const call = (bearer?: string, query = "") =>
      request(t, `/api/items/stats${query}`, { bearer });

    expect((await call()).status).toBe(401);
    expect((await call(stranger)).status).toBe(403);
    expect((await call(owner)).status).toBe(200);
    expect((await call(SERVICE, `?from=${NOW}&to=${NOW - 1}`)).status).toBe(400);
    expect((await call(SERVICE, `?from=${NOW - 93 * 24 * 60 * MINUTE}&to=${NOW}`)).status).toBe(
      400,
    );
  });
});
