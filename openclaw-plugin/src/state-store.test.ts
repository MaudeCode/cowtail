import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CowtailStateStore } from "./state-store.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cowtail-openclaw-state-"));
  tempRoots.push(root);
  return root;
}

describe("CowtailStateStore", () => {
  test("persists replay cursor per account", async () => {
    const root = await makeRoot();
    const defaultStore = new CowtailStateStore(root, "default");
    const opsStore = new CowtailStateStore(root, "ops");

    expect(await defaultStore.readLastSeenSequence()).toBeUndefined();
    expect(await opsStore.readLastSeenSequence()).toBeUndefined();

    await defaultStore.writeLastSeenSequence(42);
    await opsStore.writeLastSeenSequence(7);

    const reloadedDefault = new CowtailStateStore(root, "default");
    const reloadedOps = new CowtailStateStore(root, "ops");
    expect(await reloadedDefault.readLastSeenSequence()).toBe(42);
    expect(await reloadedOps.readLastSeenSequence()).toBe(7);
  });

  test("keeps traversal-ish account ids inside the cowtail state directory", async () => {
    const root = await makeRoot();
    const store = new CowtailStateStore(root, "../other");
    const baseDir = path.resolve(root, "plugins", "cowtail");
    const expectedPath = path.resolve(baseDir, encodeURIComponent("../other"), "state.json");

    expect(store.filePath).toBe(expectedPath);
    const relativePath = path.relative(baseDir, store.filePath);
    expect(relativePath === ".." || relativePath.startsWith(`..${path.sep}`)).toBe(false);
  });

  test("ignores corrupt state files", async () => {
    const root = await makeRoot();
    const store = new CowtailStateStore(root, "default");
    await fs.mkdir(path.dirname(store.filePath), { recursive: true });
    await fs.writeFile(store.filePath, "not json", "utf8");

    expect(await store.readLastSeenSequence()).toBeUndefined();
  });

  test("ignores invalid sequence writes without overwriting a valid cursor", async () => {
    const root = await makeRoot();
    const store = new CowtailStateStore(root, "default");

    await store.writeLastSeenSequence(42);
    await store.writeLastSeenSequence(-1);
    await store.writeLastSeenSequence(3.5);

    const reloaded = new CowtailStateStore(root, "default");
    expect(await reloaded.readLastSeenSequence()).toBe(42);
  });
});
