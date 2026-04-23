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
    const store = new CowtailStateStore(root, "default");

    expect(await store.readLastSeenSequence()).toBeUndefined();
    await store.writeLastSeenSequence(42);

    const reloaded = new CowtailStateStore(root, "default");
    expect(await reloaded.readLastSeenSequence()).toBe(42);
  });

  test("ignores corrupt state files", async () => {
    const root = await makeRoot();
    const store = new CowtailStateStore(root, "default");
    await fs.mkdir(path.dirname(store.filePath), { recursive: true });
    await fs.writeFile(store.filePath, "not json", "utf8");

    expect(await store.readLastSeenSequence()).toBeUndefined();
  });
});
