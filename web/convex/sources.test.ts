import { createHash } from "node:crypto";

import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { type Backend, newBackendWithSources, request, rows, stubEnv } from "../test/convexHarness";

const SERVICE = "service-token";
const ORIGIN = "https://cowtail.example.test";

beforeEach(() => {
  stubEnv({ PUSH_API_BEARER_TOKEN: SERVICE, COWTAIL_WEB_ORIGIN: ORIGIN });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Json = Record<string, any>;

async function api(
  t: Backend,
  path: string,
  init: { method?: string; bearer?: string; body?: unknown } = {},
) {
  const response = await request(t, path, { bearer: SERVICE, ...init });
  return { status: response.status, json: response.json as Json };
}

async function createSource(t: Backend, slug = "deployer", displayName = "Mac deployer") {
  const created = await api(t, "/api/sources", { method: "POST", body: { slug, displayName } });
  expect(created.status).toBe(200);
  return created.json.token as string;
}

function postItem(t: Backend, bearer: string, body: Json = {}) {
  return api(t, "/api/items", {
    method: "POST",
    bearer,
    body: { kind: "done", urgency: "whenever", title: "Deployed", ...body },
  });
}

// A PNG signature and IHDR chunk header: all the server reads of an icon.
function png(width: number, height: number, size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function putIcon(t: Backend, slug: string, body: Uint8Array) {
  return t.fetch(`/api/sources/${slug}/icon`, {
    method: "PUT",
    headers: { authorization: `Bearer ${SERVICE}`, "content-type": "image/png" },
    body,
  });
}

describe("source registration", () => {
  test("creating a source returns its token once and stores only the token's digest", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);

    expect(token).toMatch(/^cts_[A-Za-z0-9_-]{43}$/);
    const [stored] = (await rows(t, "sources")).filter((row) => row.slug === "deployer");
    expect(stored.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);

    const listed = await api(t, "/api/sources");
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.json)).not.toContain(stored.tokenHash!);
    expect(listed.json.sources).toContainEqual(
      expect.objectContaining({ slug: "deployer", displayName: "Mac deployer", hasToken: true }),
    );
  });

  test("a duplicate slug returns 409", async () => {
    const t = await newBackendWithSources();
    await createSource(t);
    const again = await api(t, "/api/sources", {
      method: "POST",
      body: { slug: "deployer", displayName: "Other" },
    });
    expect(again.status).toBe(409);
  });

  test("the built-in sources seed once, without tokens", async () => {
    const t = await newBackendWithSources();
    const seed = makeFunctionReference<"mutation", {}, { created: number }>(
      "sources:seedBuiltinSources",
    );
    expect(await t.mutation(seed, {})).toEqual({ created: 0 });
    const seeded = await rows(t, "sources");
    expect(seeded.map((row) => row.slug).sort()).toEqual([
      "alertmanager",
      "cowtail",
      "hermes",
      "manual",
    ]);
    expect(seeded.every((row) => row.tokenHash === undefined && row.enabled)).toBe(true);
  });
});

describe("source tokens", () => {
  test("rotating a token makes the old one fail with 403 and the new one work", async () => {
    const t = await newBackendWithSources();
    const old = await createSource(t);
    const rotated = await api(t, "/api/sources/deployer/token", { method: "POST" });
    expect(rotated.status).toBe(200);

    expect((await postItem(t, old)).status).toBe(403);
    expect((await postItem(t, rotated.json.token)).status).toBe(200);
  });

  test("an item posted with a source token belongs to that source, whatever the body says", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);
    const created = await postItem(t, token, { source: "alertmanager" });
    expect(created.status).toBe(200);

    const item = await api(t, `/api/items/${created.json.id}`);
    expect(item.json.item).toMatchObject({
      source: "deployer",
      sourceInfo: { slug: "deployer", displayName: "Mac deployer" },
    });
    expect(item.json.events[0].actor).toBe("deployer");
    expect((await postItem(t, token, { source: "Not A Source!" })).status).toBe(200);
  });

  test("a disabled source's token, or an unknown one, returns 403", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);
    const disabled = await api(t, "/api/sources/deployer", {
      method: "PATCH",
      body: { enabled: false },
    });
    expect(disabled.json.source).toMatchObject({ enabled: false });

    expect((await postItem(t, token)).status).toBe(403);
    expect((await postItem(t, "cts_unknown")).status).toBe(403);
  });

  test("a source token is refused on every route but item ingest and events", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);
    for (const [method, path] of [
      ["POST", "/api/push/send"],
      ["GET", "/api/users"],
      ["GET", "/api/sources"],
      ["POST", "/api/sources"],
      ["GET", "/api/items"],
    ]) {
      const response = await api(t, path, {
        method,
        bearer: token,
        body: method === "POST" ? {} : undefined,
      });
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
    }
  });

  test("a source token appends events only to its own source's items", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);
    const own = await postItem(t, token);
    const hermes = await postItem(t, SERVICE, { source: "hermes" });
    const note = { type: "hermes_update", text: "Still deploying" };

    const refused = await api(t, `/api/items/${hermes.json.id}/events`, {
      method: "POST",
      bearer: token,
      body: note,
    });
    expect(refused.status).toBe(403);
    const appended = await api(t, `/api/items/${own.json.id}/events`, {
      method: "POST",
      bearer: token,
      body: note,
    });
    expect(appended.status).toBe(200);

    const hermesEvents = (await api(t, `/api/items/${hermes.json.id}`)).json.events;
    expect(hermesEvents.map((event: Json) => event.type)).not.toContain("hermes_update");
  });

  test("a source token's dedupeKey never counts into another source's item", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);
    const hermes = await postItem(t, SERVICE, { source: "hermes", dedupeKey: "shared" });
    const deployer = await postItem(t, token, { dedupeKey: "shared" });

    expect(deployer.json).toMatchObject({ created: true, occurrenceCount: 1 });
    expect(deployer.json.id).not.toBe(hermes.json.id);
    const hermesItem = (await api(t, `/api/items/${hermes.json.id}`)).json.item;
    expect(hermesItem.occurrenceCount).toBe(1);
  });

  test("service auth must name a registered source", async () => {
    const t = await newBackendWithSources();
    expect((await postItem(t, SERVICE, { source: "nobody" })).status).toBe(400);
    expect((await postItem(t, SERVICE)).status).toBe(400);
    expect((await postItem(t, SERVICE, { source: "hermes" })).status).toBe(200);
  });
});

describe("source icons", () => {
  test("refuses anything but a square PNG of 64 to 1024 pixels, at most 256 KB", async () => {
    const t = await newBackendWithSources();
    await createSource(t);
    const notPng = new TextEncoder().encode(
      "GIF89a, not a PNG at all, padded to twenty-four bytes",
    );
    for (const body of [
      notPng,
      png(128, 128, 256 * 1024 + 1),
      png(128, 96),
      png(32, 32),
      png(2048, 2048),
    ]) {
      expect((await putIcon(t, "deployer", body)).status).toBe(400);
    }
    expect((await putIcon(t, "nobody", png(128, 128))).status).toBe(404);
  });

  test("an uploaded icon is served publicly with caching headers and replaces the old file", async () => {
    const t = await newBackendWithSources();
    await createSource(t);
    expect((await t.fetch("/api/sources/deployer/icon")).status).toBe(404);

    expect((await putIcon(t, "deployer", png(64, 64))).status).toBe(200);
    const first = (await rows(t, "sources")).find((row) => row.slug === "deployer")!;
    const replaced = await putIcon(t, "deployer", png(1024, 1024, 128));
    expect(replaced.status).toBe(200);
    const second = (await rows(t, "sources")).find((row) => row.slug === "deployer")!;

    const icon = await t.fetch("/api/sources/deployer/icon");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect(icon.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(icon.headers.get("etag")).toBe(`"${second.iconStorageId}"`);
    expect(new Uint8Array(await icon.arrayBuffer())).toEqual(png(1024, 1024, 128));

    const old = await t.run((ctx) => ctx.storage.get(first.iconStorageId as Id<"_storage">));
    expect(old).toBeNull();
  });

  test("items name their source's icon URL once the source has one", async () => {
    const t = await newBackendWithSources();
    const token = await createSource(t);
    const before = await postItem(t, token);
    expect((await api(t, `/api/items/${before.json.id}`)).json.item.sourceInfo).toEqual({
      slug: "deployer",
      displayName: "Mac deployer",
    });

    await putIcon(t, "deployer", png(128, 128));
    const listed = await api(t, "/api/items");
    expect(listed.json.items[0].sourceInfo).toEqual({
      slug: "deployer",
      displayName: "Mac deployer",
      iconUrl: `${ORIGIN}/actions/api/sources/deployer/icon`,
    });
  });
});
